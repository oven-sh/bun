#pragma once

#include <cstddef>
#include <cstdint>

// The C ABI of src/parsers/xml_dom.rs, where it is documented. Every type and number here mirrors that file.

namespace WebCore {

// A part of the `strings` of the list, in UTF-16 code units.
struct BunXMLStringRange {
    uint32_t offset;
    uint32_t length;
};

enum class BunXMLEventKind : uint8_t {
    // `first` is the qualified name. The Attributes of the element follow, those that the DTD defaults last.
    StartElement = 0,
    // `first` is the qualified name, `second` the normalized value.
    Attribute = 1,
    EndElement = 2,
    // `first` is the data, also of the next two.
    Text = 3,
    CDATASection = 4,
    Comment = 5,
    // `first` is the target, `second` the data.
    ProcessingInstruction = 6,
    // Only the place of the doctype. Its strings are in the list.
    DocumentType = 7,
};

struct BunXMLEvent {
    BunXMLEventKind kind;
    // StartElement: where the tag starts, in code units of the input.
    uint32_t position;
    BunXMLStringRange first;
    BunXMLStringRange second;
};

enum class BunXMLStandalone : uint8_t {
    Unspecified = 0,
    No = 1,
    Yes = 2,
};

struct BunXMLEventList {
    BunXMLEvent* events;
    size_t eventCount;
    char16_t* strings;
    size_t stringsLength;
    // UTF-8, and empty if the input is well-formed. Otherwise `events` is what came before the error.
    uint8_t* errorMessage;
    size_t errorMessageLength;
    // In code units of the input.
    size_t errorPosition;
    BunXMLStringRange xmlVersion;
    BunXMLStringRange xmlEncoding;
    BunXMLStringRange doctypeName;
    BunXMLStringRange doctypePublicId;
    BunXMLStringRange doctypeSystemId;
    bool hasXMLDeclaration;
    BunXMLStandalone standalone;
};

static_assert(sizeof(BunXMLEvent) == 24);
static_assert(offsetof(BunXMLEvent, position) == 4);
static_assert(offsetof(BunXMLEvent, first) == 8);
static_assert(offsetof(BunXMLEventList, xmlVersion) == 7 * sizeof(size_t));
static_assert(offsetof(BunXMLEventList, standalone) == 7 * sizeof(size_t) + 41);

extern "C" {

// False if HTML has no `&name;`. Otherwise writes its one or two code points, the second 0 if there is one.
using BunXMLHTMLEntityLookup = bool (*)(const char16_t* name, size_t nameLength, uint32_t (*codePoints)[2]);

// Whether `input` is well-formed XML 1.0, namespaces aside. Always writes `result`, which Rust owns: give it back with the free function.
bool Bun__XML__DOM__parse(const char16_t* input, size_t inputLength, BunXMLHTMLEntityLookup, BunXMLEventList* result);
void Bun__XML__DOM__freeEventList(BunXMLEventList*);

}

} // namespace WebCore
