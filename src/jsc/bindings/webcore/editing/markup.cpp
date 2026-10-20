/*
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2008, 2009, 2010, 2011 Google Inc. All rights reserved.
 * Copyright (C) 2011 Igalia S.L.
 * Copyright (C) 2011 Motorola Mobility. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */

#include "config.h"
#include "markup.h"

#include "ChildListMutationScope.h"
#include "ContainerNodeInlines.h"
#include "CustomElementRegistry.h"
#include "Document.h"
#include "DocumentFragment.h"
#include "ElementChildIteratorInlines.h"
#include "HTMLBodyElement.h"
#include "HTMLHeadElement.h"
#include "HTMLHtmlElement.h"
#include "HTMLNames.h"
#include "HTMLTemplateElement.h"
#include "MarkupAccumulator.h"
#include "ScriptWrappableInlines.h"
#include "Text.h"

namespace WebCore {

using namespace HTMLNames;

String serializeFragment(const Node& node, SerializedNodes root, Vector<Ref<Node>>* nodes, ResolveURLs resolveURLs, std::optional<SerializationSyntax> serializationSyntax, SerializeShadowRoots serializeShadowRoots, Vector<Ref<ShadowRoot>>&& explicitShadowRoots)
{
    if (!serializationSyntax)
        serializationSyntax = MarkupAccumulator::serializationSyntax(node.document());

    MarkupAccumulator accumulator(nodes, resolveURLs, *serializationSyntax, serializeShadowRoots, WTF::move(explicitShadowRoots));
    return accumulator.serializeNodes(const_cast<Node&>(node), root);
}

enum class DocumentFragmentMode : bool { New, ReuseForInnerOuterHTML };
static ALWAYS_INLINE ExceptionOr<Ref<DocumentFragment>> createFragmentForMarkup(Element& contextElement, const String& markup, DocumentFragmentMode mode, OptionSet<ParserContentPolicy> parserContentPolicy, CustomElementRegistry* registry = nullptr, Element::CustomElementRegistryKind registryKind = Element::CustomElementRegistryKind::Window)
{
    Ref document = contextElement.hasTagName(templateTag) ? protect(contextElement.document())->ensureTemplateDocument() : contextElement.document();
    auto fragment = mode == DocumentFragmentMode::New ? DocumentFragment::create(document.get()) : document->documentFragmentForInnerOuterHTML();
    ASSERT(!fragment->hasChildNodes());

    if (registryKind == Element::CustomElementRegistryKind::Null)
        fragment->setUsesNullCustomElementRegistry();
    else
        fragment->clearUsesNullCustomElementRegistry();

    if (document->isHTMLDocument() || parserContentPolicy.contains(ParserContentPolicy::AlwaysParseAsHTML)) {
        fragment->parseHTML(markup, contextElement, parserContentPolicy, registry);
        return fragment;
    }

    bool wasValid = fragment->parseXML(markup, &contextElement, parserContentPolicy);
    if (!wasValid)
        return Exception { ExceptionCode::SyntaxError };
    return fragment;
}

ExceptionOr<Ref<DocumentFragment>> createFragmentForInnerOuterHTML(Element& contextElement, const String& markup, OptionSet<ParserContentPolicy> parserContentPolicy, CustomElementRegistry* registry, Element::CustomElementRegistryKind registryKind)
{
    return createFragmentForMarkup(contextElement, markup, DocumentFragmentMode::ReuseForInnerOuterHTML, parserContentPolicy, registry, registryKind);
}

static Vector<Ref<HTMLElement>> collectElementsToRemoveFromFragment(ContainerNode& container)
{
    Vector<Ref<HTMLElement>> toRemove;
    for (Ref element : childrenOfType<HTMLElement>(container)) {
        if (is<HTMLHtmlElement>(element)) {
            toRemove.append(element);
            toRemove.appendVector(collectElementsToRemoveFromFragment(element));
            continue;
        }
        if (isAnyOf<HTMLHeadElement, HTMLBodyElement>(element))
            toRemove.append(WTF::move(element));
    }
    return toRemove;
}

static void removeElementFromFragmentPreservingChildren(DocumentFragment& fragment, HTMLElement& element)
{
    RefPtr<Node> nextChild;
    for (RefPtr child = element.firstChild(); child; child = nextChild) {
        nextChild = child->nextSibling();
        element.removeChild(*child);
        fragment.insertBefore(*child, &element);
    }
    fragment.removeChild(element);
}

ExceptionOr<Ref<DocumentFragment>> createContextualFragment(Element& element, const String& markup, OptionSet<ParserContentPolicy> parserContentPolicy)
{
    Ref registryContainer = [&] -> Ref<Node> {
        if (RefPtr templateElement = dynamicDowncast<HTMLTemplateElement>(element))
            return templateElement->content();
        return element;
    }();
    auto registryKind = registryContainer->usesNullCustomElementRegistry() ? Element::CustomElementRegistryKind::Null : Element::CustomElementRegistryKind::Window;
    auto result = createFragmentForMarkup(element, markup, DocumentFragmentMode::New, parserContentPolicy, protect(CustomElementRegistry::registryForNodeOrTreeScope(registryContainer, protect(registryContainer->treeScope()))), registryKind);
    if (result.hasException())
        return result.releaseException();

    auto fragment = result.releaseReturnValue();

    // We need to pop <html> and <body> elements and remove <head> to
    // accommodate folks passing complete HTML documents to make the
    // child of an element.
    auto toRemove = collectElementsToRemoveFromFragment(fragment);
    for (auto& element : toRemove)
        removeElementFromFragmentPreservingChildren(fragment, element);

    return fragment;
}

static inline RefPtr<Text> LEGACY_NODELETE singleTextChild(ContainerNode& node)
{
    return node.hasOneChild() ? dynamicDowncast<Text>(node.firstChild()) : nullptr;
}

// We can use setData instead of replacing Text node as long as script can't observe the difference.
static inline bool canUseSetDataOptimization(const Text& containerChild, const ChildListMutationScope& mutationScope)
{
    bool authorScriptMayHaveReference = containerChild.refCount();
    return !authorScriptMayHaveReference && !mutationScope.canObserve();
}

ExceptionOr<void> replaceChildrenWithFragment(ContainerNode& container, Ref<DocumentFragment>&& fragment)
{
    Ref containerNode(container);
    ChildListMutationScope mutation(containerNode);

    if (!fragment->firstChild()) {
        containerNode->removeChildren();
        return { };
    }

    // We don't Use RefPtr here because canUseSetDataOptimization() below relies on the
    // containerChild's ref count.
    SUPPRESS_UNCOUNTED_LOCAL auto* containerChild = dynamicDowncast<Text>(containerNode->firstChild());
    if (containerChild && !containerChild->nextSibling()) {
        if (RefPtr fragmentChild = singleTextChild(fragment); fragmentChild && canUseSetDataOptimization(*containerChild, mutation)) {
            protect(*containerChild)->setData(fragmentChild->data());
            return { };
        }
        return containerNode->replaceChild(fragment, protect(*containerChild));
    }

    containerNode->removeChildren();
    auto result = containerNode->appendChild(fragment);
    ASSERT(!fragment->hasChildNodes());
    ASSERT(!fragment->wrapper());
    return result;
}

}
