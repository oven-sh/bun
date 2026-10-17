#include "config.h"
#include "UserAgentStyle.h"

#include "ElementInlines.h"
#include "ElementTextDirection.h"
#include "HTMLDialogElement.h"
#include "HTMLNames.h"
#include "NodeName.h"
#include "WritingMode.h"

namespace WebCore {
namespace Style {

using namespace HTMLNames;

static bool isHiddenByAttribute(const Element& element)
{
    auto& hidden = element.attributeWithoutSynchronization(hiddenAttr);
    return !hidden.isNull() && !equalLettersIgnoringASCIICase(hidden, "until-found"_s);
}

static bool inputTypeIs(const Element& element, ASCIILiteral type)
{
    return equalIgnoringASCIICase(element.attributeWithoutSynchronization(typeAttr), type);
}

static ASCIILiteral displayForTag(const Element& element)
{
    using namespace ElementNames;

    switch (element.elementName()) {
    case HTML::html:
    case HTML::body:
    case HTML::address:
    case HTML::blockquote:
    case HTML::center:
    case HTML::div:
    case HTML::figure:
    case HTML::figcaption:
    case HTML::footer:
    case HTML::form:
    case HTML::header:
    case HTML::hr:
    case HTML::legend:
    case HTML::listing:
    case HTML::main:
    case HTML::p:
    case HTML::plaintext:
    case HTML::pre:
    case HTML::search:
    case HTML::xmp:
    case HTML::article:
    case HTML::aside:
    case HTML::h1:
    case HTML::h2:
    case HTML::h3:
    case HTML::h4:
    case HTML::h5:
    case HTML::h6:
    case HTML::hgroup:
    case HTML::nav:
    case HTML::section:
    case HTML::dir:
    case HTML::dd:
    case HTML::dl:
    case HTML::dt:
    case HTML::menu:
    case HTML::ol:
    case HTML::ul:
    case HTML::fieldset:
    case HTML::details:
    case HTML::optgroup:
    case HTML::option:
    case HTML::frameset:
    case HTML::frame:
        return "block"_s;
    case HTML::summary:
        // The first summary of a details element is its marker.
        if (auto* parent = element.parentElement(); parent && parent->hasTagName(detailsTag)) {
            for (auto* sibling = element.previousElementSibling(); sibling; sibling = sibling->previousElementSibling()) {
                if (sibling->hasTagName(summaryTag))
                    return "block"_s;
            }
            return "list-item"_s;
        }
        return "block"_s;
    case HTML::dialog:
        return element.hasAttributeWithoutSynchronization(openAttr) ? "block"_s : "none"_s;
    case HTML::li:
        return "list-item"_s;
    case HTML::table:
        return "table"_s;
    case HTML::caption:
        return "table-caption"_s;
    case HTML::colgroup:
        return "table-column-group"_s;
    case HTML::col:
        return "table-column"_s;
    case HTML::thead:
        return "table-header-group"_s;
    case HTML::tbody:
        return "table-row-group"_s;
    case HTML::tfoot:
        return "table-footer-group"_s;
    case HTML::tr:
        return "table-row"_s;
    case HTML::td:
    case HTML::th:
        return "table-cell"_s;
    case HTML::input:
        return inputTypeIs(element, "hidden"_s) ? "none"_s : "inline-block"_s;
    case HTML::button:
    case HTML::select:
    case HTML::textarea:
    case HTML::meter:
    case HTML::progress:
    case HTML::marquee:
        return "inline-block"_s;
    case HTML::slot:
        return "contents"_s;
    case HTML::ruby:
        return "ruby"_s;
    case HTML::rt:
        return "ruby-text"_s;
    case HTML::audio:
        return element.hasAttributeWithoutSynchronization(controlsAttr) ? ASCIILiteral() : "none"_s;
    case HTML::area:
    case HTML::base:
    case HTML::basefont:
    case HTML::datalist:
    case HTML::head:
    case HTML::link:
    case HTML::meta:
    case HTML::noembed:
    case HTML::noframes:
    case HTML::param:
    case HTML::rp:
    case HTML::script:
    case HTML::style:
    case HTML::template_:
    case HTML::title:
        return "none"_s;
    default:
        return { };
    }
}

static ASCIILiteral display(const Element& element)
{
    using namespace ElementNames;

    if (!element.isHTMLElement()) {
        switch (element.elementName()) {
        case SVG::title:
            return "none"_s;
        case SVG::text:
        case SVG::foreignObject:
            return "block"_s;
        default:
            return { };
        }
    }

    if (element.hasAttributesWithoutUpdate()) {
        if (isHiddenByAttribute(element)) {
            switch (element.elementName()) {
            // These stay what they are and collapse.
            case HTML::colgroup:
            case HTML::col:
            case HTML::thead:
            case HTML::tbody:
            case HTML::tfoot:
            case HTML::tr:
            case HTML::embed:
                break;
            default:
                return "none"_s;
            }
        }
        if (element.hasAttributeWithoutSynchronization(popoverAttr) && !element.isPopoverShowing()
            && !(element.hasTagName(dialogTag) && element.hasAttributeWithoutSynchronization(openAttr)))
            return "none"_s;
    }
    return displayForTag(element);
}

static ASCIILiteral valueForHTMLElement(const Element& element, CSSPropertyID id)
{
    using namespace ElementNames;

    auto name = element.elementName();
    switch (id) {
    case CSSPropertyID::FontWeight:
        switch (name) {
        case HTML::b:
        case HTML::strong:
        case HTML::th:
        case HTML::h1:
        case HTML::h2:
        case HTML::h3:
        case HTML::h4:
        case HTML::h5:
        case HTML::h6:
            return "bold"_s;
        default:
            return { };
        }
    case CSSPropertyID::FontStyle:
        switch (name) {
        case HTML::address:
        case HTML::cite:
        case HTML::dfn:
        case HTML::em:
        case HTML::i:
        case HTML::var:
            return "italic"_s;
        default:
            return { };
        }
    case CSSPropertyID::FontFamily:
        switch (name) {
        case HTML::code:
        case HTML::kbd:
        case HTML::samp:
        case HTML::tt:
        case HTML::listing:
        case HTML::plaintext:
        case HTML::pre:
        case HTML::xmp:
            return "monospace"_s;
        default:
            return { };
        }
    case CSSPropertyID::WhiteSpace:
        switch (name) {
        case HTML::listing:
        case HTML::plaintext:
        case HTML::pre:
        case HTML::xmp:
            return "pre"_s;
        case HTML::textarea:
            return "pre-wrap"_s;
        case HTML::nobr:
            return "nowrap"_s;
        default:
            return { };
        }
    case CSSPropertyID::TextDecorationLine:
        switch (name) {
        case HTML::ins:
        case HTML::u:
            return "underline"_s;
        case HTML::del:
        case HTML::s:
        case HTML::strike:
            return "line-through"_s;
        default:
            return element.isLink() ? "underline"_s : ASCIILiteral();
        }
    case CSSPropertyID::Cursor:
        return element.isLink() ? "pointer"_s : ASCIILiteral();
    case CSSPropertyID::Color:
        if (element.isLink())
            return "rgb(0, 0, 238)"_s;
        return name == HTML::mark ? "rgb(0, 0, 0)"_s : ASCIILiteral();
    case CSSPropertyID::BackgroundColor:
        return name == HTML::mark ? "rgb(255, 255, 0)"_s : ASCIILiteral();
    case CSSPropertyID::MarginTop:
    case CSSPropertyID::MarginRight:
    case CSSPropertyID::MarginBottom:
    case CSSPropertyID::MarginLeft:
        return name == HTML::body ? "8px"_s : ASCIILiteral();
    case CSSPropertyID::ListStyleType:
        return name == HTML::ol ? "decimal"_s : ASCIILiteral();
    case CSSPropertyID::VerticalAlign:
        if (name == HTML::sub)
            return "sub"_s;
        return name == HTML::sup ? "super"_s : ASCIILiteral();
    case CSSPropertyID::TextAlign:
        switch (name) {
        case HTML::caption:
        case HTML::button:
            return "center"_s;
        default:
            return { };
        }
    case CSSPropertyID::BoxSizing:
        switch (name) {
        case HTML::table:
        case HTML::button:
        case HTML::select:
            return "border-box"_s;
        case HTML::input:
            for (auto type : { "checkbox"_s, "radio"_s, "submit"_s, "button"_s, "reset"_s, "color"_s, "search"_s }) {
                if (inputTypeIs(element, type))
                    return "border-box"_s;
            }
            return { };
        default:
            return { };
        }
    case CSSPropertyID::Direction: {
        auto& dir = element.attributeWithoutSynchronization(dirAttr);
        if (equalLettersIgnoringASCIICase(dir, "rtl"_s))
            return "rtl"_s;
        if (equalLettersIgnoringASCIICase(dir, "ltr"_s))
            return "ltr"_s;
        // dir=auto, and <bdi> without dir.
        if (auto direction = computeTextDirectionIfDirIsAuto(element))
            return *direction == TextDirection::LTR ? "ltr"_s : "rtl"_s;
        // input[type=tel i]:dir(ltr) { direction: ltr; }
        if (name == HTML::input && inputTypeIs(element, "tel"_s) && element.effectiveTextDirection() == TextDirection::LTR)
            return "ltr"_s;
        return { };
    }
    case CSSPropertyID::Position:
        if (auto* dialog = dynamicDowncast<HTMLDialogElement>(element))
            return dialog->isModal() ? "fixed"_s : "absolute"_s;
        return { };
    case CSSPropertyID::OutlineStyle:
        // :not(html, body, input[readonly], applet, embed, iframe, object):focus-visible { outline-style: auto; }
        if (!element.hasFocusVisible())
            return { };
        switch (name) {
        case HTML::html:
        case HTML::body:
        case HTML::applet:
        case HTML::embed:
        case HTML::iframe:
        case HTML::object:
            return { };
        case HTML::input:
            return element.hasAttributeWithoutSynchronization(readonlyAttr) ? ASCIILiteral() : "auto"_s;
        default:
            return "auto"_s;
        }
    case CSSPropertyID::Visibility:
        switch (name) {
        case HTML::colgroup:
        case HTML::col:
        case HTML::thead:
        case HTML::tbody:
        case HTML::tfoot:
        case HTML::tr:
            return isHiddenByAttribute(element) ? "collapse"_s : ASCIILiteral();
        default:
            return { };
        }
    case CSSPropertyID::ContentVisibility:
        return equalLettersIgnoringASCIICase(element.attributeWithoutSynchronization(hiddenAttr), "until-found"_s) ? "hidden"_s : ASCIILiteral();
    default:
        return { };
    }
}

ASCIILiteral UserAgentStyle::value(const Element& element, PseudoElementType pseudoElement, CSSPropertyID id)
{
    if (pseudoElement != PseudoElementType::None) {
        // Without a rule that sets `content`, ::before and ::after generate no box.
        if (id == CSSPropertyID::Content && (pseudoElement == PseudoElementType::Before || pseudoElement == PseudoElementType::After))
            return "none"_s;
        return { };
    }
    if (id == CSSPropertyID::Display)
        return display(element);
    if (!element.isHTMLElement())
        return { };
    return valueForHTMLElement(element, id);
}

} // namespace Style
} // namespace WebCore
