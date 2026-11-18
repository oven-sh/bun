#pragma once

namespace WTF {

class ASCIILiteral;
class AtomString;
class AtomStringImpl;
class ExternalStringImpl;
class OrdinalNumber;
class PrintStream;
class RegisteredSymbolImpl;
class String;
class StringBuilder;
class StringImpl;
class StringView;
class SymbolImpl;
class SymbolRegistry;
class TextPosition;
class URL;
class URLParser;
class UniquedStringImpl;

struct Latin1Character;

template<typename> class CString;
template<typename> class StringTypeAdapter;

using Latin1CString = CString<Latin1Character>;
using UTF8CString = CString<char8_t>;

namespace JSONImpl {
class Array;
class Object;
class Value;
template<typename> class ArrayOf;
}

}

namespace JSON {
using namespace WTF::JSONImpl;
}

using WTF::ASCIILiteral;
using WTF::AtomString;
using WTF::AtomStringImpl;
using WTF::CString;
using WTF::ExternalStringImpl;
using WTF::Latin1Character;
using WTF::Latin1CString;
using WTF::OrdinalNumber;
using WTF::PrintStream;
using WTF::RegisteredSymbolImpl;
using WTF::String;
using WTF::StringBuilder;
using WTF::StringImpl;
using WTF::StringView;
using WTF::SymbolImpl;
using WTF::SymbolRegistry;
using WTF::TextPosition;
using WTF::UniquedStringImpl;
using WTF::URL;
using WTF::UTF8CString;
