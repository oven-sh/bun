/*
 *  Copyright (C) 2001 Peter Kelly (pmk@post.com)
 *  Copyright (C) 2003-2019 Apple Inc. All rights reserved.
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#include "config.h"
#include "JSLazyEventListener.h"

#include "Document.h"
#include "Element.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMWrapperCache.h"
#include "JSHTMLElement.h"
#include "JSWindow.h"
#include "QualifiedName.h"
#include "ScriptableDocumentParser.h"
#include "Window.h"
#include <JavaScriptCore/FunctionConstructor.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/JSWithScope.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <wtf/StdLibExtras.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/MakeString.h>

namespace WebCore {
using namespace JSC;

struct JSLazyEventListener::CreationArguments {
    const QualifiedName& attributeName;
    const AtomString& attributeValue;
    Ref<Document> document;
    WeakPtr<ContainerNode, WeakPtrImplWithEventTargetData> node;
    JSObject* wrapper;
};

static TextPosition LEGACY_NODELETE convertZeroToOne(const TextPosition& position)
{
    // A JSLazyEventListener can be created with a line number of zero when it is created with
    // a setAttribute call from JavaScript, so make the line number 1 in that case.
    if (position == TextPosition::belowRangePosition())
        return { };
    return position;
}

JSLazyEventListener::JSLazyEventListener(CreationArguments&& arguments, const URL& sourceURL, const TextPosition& sourcePosition)
    : JSEventListener(nullptr, arguments.wrapper, true, CreatedFromMarkup::Yes, mainThreadNormalWorldSingleton())
    , m_functionName(arguments.attributeName.localName().string())
    , m_code(arguments.attributeValue)
    , m_sourceURL(sourceURL)
    , m_sourcePosition(convertZeroToOne(sourcePosition))
    , m_originalNode(WTF::move(arguments.node))
    , m_sourceTaintedOrigin(JSC::computeNewSourceTaintednessFromStack(arguments.document->vm(), arguments.document->vm().topCallFrame))
{
}

#if ASSERT_ENABLED
// This is to help find the underlying cause of <rdar://problem/24314027>.
void JSLazyEventListener::checkValidityForEventTarget(EventTarget& eventTarget)
{
    if (eventTarget.isNode()) {
        ASSERT(m_originalNode);
        ASSERT(static_cast<EventTarget*>(m_originalNode.get()) == &eventTarget);
    } else
        ASSERT(!m_originalNode);
}
#endif

JSLazyEventListener::~JSLazyEventListener() = default;

JSObject* JSLazyEventListener::initializeJSFunction(ScriptExecutionContext& executionContext) const
{
    // A document without a window has no browsing context: scripting is disabled for it, as for upstream's document without a frame.
    RefPtr<Window> window;
    if (m_originalNode) {
        window = m_originalNode->document().window();
        if (!window)
            return nullptr;
    }

    auto* globalObject = uncheckedDowncast<JSDOMGlobalObject>(executionContext.globalObject());
    if (!globalObject)
        return nullptr;

    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSGlobalObject* lexicalGlobalObject = globalObject;

    constexpr auto functionPrefix = "function "_s;
    constexpr auto functionParameters = "(event)"_s;
    int functionConstructorParametersEndPosition = functionPrefix.length() + m_functionName.length() + functionParameters.length();
    String code = makeString(functionPrefix, m_functionName, functionParameters, " {\n"_s, m_code, "\n}"_s);

    // We want all errors to refer back to the line on which our attribute was
    // declared, regardless of any newlines in our JavaScript source text.
    int overrideLineNumber = m_sourcePosition.m_line.oneBasedInt();

    JSObject* jsFunction = constructFunctionSkippingEvalEnabledCheck(
        lexicalGlobalObject, WTF::move(code), TaintedByWithScopeLexicallyScopedFeature, Identifier::fromString(vm, m_functionName),
        SourceOrigin { m_sourceURL }, m_sourceURL.string(), m_sourceTaintedOrigin, m_sourcePosition, overrideLineNumber, functionConstructorParametersEndPosition);
    if (scope.exception()) [[unlikely]] {
        reportCurrentException(lexicalGlobalObject);
        scope.clearException();
        return nullptr;
    }

    if (m_originalNode && !wrapper()) {
        // Ensure that 'node' has a JavaScript wrapper to mark the event listener we're creating.
        setWrapperWhenInitializingJSFunction(vm, asObject(toJS(lexicalGlobalObject, globalObject, protect(*m_originalNode))));
    }

    // The window is the global object upstream. Here it is an ordinary object, so the handler sees its properties through the scope chain.
    JSFunction* listenerAsFunction = downcast<JSFunction>(jsFunction);
    JSObject* windowWrapper = window ? asObject(wrap(lexicalGlobalObject, globalObject, *window)) : wrapper();
    if (!windowWrapper)
        return nullptr;
    JSScope* handlerScope = JSWithScope::create(vm, lexicalGlobalObject, listenerAsFunction->scope(), windowWrapper);

    // Add the event's home element to the scope (and the document, and the form - see JSHTMLElement::eventHandlerScope)
    if (is<HTMLElement>(m_originalNode.get()))
        handlerScope = uncheckedDowncast<JSHTMLElement>(wrapper())->pushEventHandlerScope(lexicalGlobalObject, handlerScope);

    listenerAsFunction->setScope(vm, handlerScope);
    return jsFunction;
}

RefPtr<JSLazyEventListener> JSLazyEventListener::create(CreationArguments&& arguments)
{
    if (arguments.attributeValue.isNull())
        return nullptr;

    // FIXME: This location maps to the end of the HTML tag, and not to the exact column number belonging to the event handler attribute.
    auto position = TextPosition::belowRangePosition();
    if (RefPtr parser = arguments.document->scriptableDocumentParser())
        position = parser->textPosition();

    JSLockHolder locker(arguments.document->vm());
    return adoptRef(*new JSLazyEventListener(WTF::move(arguments), arguments.document->url(), position));
}

RefPtr<JSLazyEventListener> JSLazyEventListener::create(Element& element, const QualifiedName& attributeName, const AtomString& attributeValue)
{
    return create({ attributeName, attributeValue, element.document(), element, nullptr });
}

RefPtr<JSLazyEventListener> JSLazyEventListener::create(Document& document, const QualifiedName& attributeName, const AtomString& attributeValue)
{
    return create({ attributeName, attributeValue, document, document, nullptr });
}

RefPtr<JSLazyEventListener> JSLazyEventListener::create(Window& window, const QualifiedName& attributeName, const AtomString& attributeValue)
{
    ASSERT(window.document());
    Ref document = *window.document();
    auto* globalObject = uncheckedDowncast<JSDOMGlobalObject>(document->globalObject());
    return create({ attributeName, attributeValue, document, nullptr, asObject(wrap(globalObject, globalObject, window)) });
}

} // namespace WebCore
