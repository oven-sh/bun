#include "root.h"

#include "JSONSchemaValidator.h"
#include <JavaScriptCore/YarrErrorCode.h>
#include <JavaScriptCore/YarrFlags.h>
#include <JavaScriptCore/YarrPattern.h>
#include <wtf/ASCIICType.h>
#include <wtf/URL.h>

namespace Bun::JSONSchema {

using namespace WTF;
using Text = std::span<const char>;

// In the order of Format.
static constexpr ASCIILiteral formatNames[] = {
    "date-time"_s,    "date"_s,
    "time"_s,         "duration"_s,
    "email"_s,        "hostname"_s,
    "ipv4"_s,         "ipv6"_s,
    "uri"_s,          "uri-reference"_s,
    "uuid"_s,         "regex"_s,
    "json-pointer"_s, "relative-json-pointer"_s,
    "url"_s,
};
static_assert(std::size(formatNames) == static_cast<size_t>(Format::URL) + 1);

ASCIILiteral nameOf(Format format) {
  return formatNames[static_cast<size_t>(format)];
}

std::optional<Format> formatNamed(const String &name) {
  for (size_t i = 0; i < std::size(formatNames); ++i) {
    if (name == formatNames[i])
      return static_cast<Format>(i);
  }
  return std::nullopt;
}

static bool readTwoDigits(Text text, size_t at, unsigned &result) {
  if (at + 2 > text.size() || !isASCIIDigit(text[at]) ||
      !isASCIIDigit(text[at + 1]))
    return false;
  result = (text[at] - '0') * 10 + (text[at + 1] - '0');
  return true;
}

static bool isDate(Text text) {
  unsigned century, yearOfCentury, month, day;
  if (text.size() != 10 || text[4] != '-' || text[7] != '-')
    return false;
  if (!readTwoDigits(text, 0, century) ||
      !readTwoDigits(text, 2, yearOfCentury) ||
      !readTwoDigits(text, 5, month) || !readTwoDigits(text, 8, day))
    return false;
  if (month < 1 || month > 12 || day < 1)
    return false;
  static constexpr uint8_t days[] = {31, 28, 31, 30, 31, 30,
                                     31, 31, 30, 31, 30, 31};
  unsigned year = century * 100 + yearOfCentury;
  bool isLeapYear = !(year % 4) && ((year % 100) || !(year % 400));
  return day <= days[month - 1] + (month == 2 && isLeapYear ? 1u : 0u);
}

static bool isTime(Text text) {
  unsigned hour, minute, second;
  if (text.size() < 9 || text[2] != ':' || text[5] != ':')
    return false;
  if (!readTwoDigits(text, 0, hour) || !readTwoDigits(text, 3, minute) ||
      !readTwoDigits(text, 6, second))
    return false;
  if (hour > 23 || minute > 59 || second > 60)
    return false;
  size_t at = 8;
  if (text[at] == '.') {
    size_t start = ++at;
    while (at < text.size() && isASCIIDigit(text[at]))
      ++at;
    if (at == start)
      return false;
  }
  if (at >= text.size())
    return false;
  int offset = 0;
  if (text[at] == 'Z' || text[at] == 'z') {
    if (at + 1 != text.size())
      return false;
  } else if (text[at] == '+' || text[at] == '-') {
    unsigned offsetHour, offsetMinute;
    if (at + 6 != text.size() || text[at + 3] != ':' ||
        !readTwoDigits(text, at + 1, offsetHour) ||
        !readTwoDigits(text, at + 4, offsetMinute))
      return false;
    if (offsetHour > 23 || offsetMinute > 59)
      return false;
    offset = static_cast<int>(offsetHour * 60 + offsetMinute) *
             (text[at] == '+' ? 1 : -1);
  } else
    return false;
  if (second == 60) {
    int utc = (static_cast<int>(hour * 60 + minute) - offset + 2880) % 1440;
    return utc == 1439;
  }
  return true;
}

static bool isDateTime(Text text) {
  return text.size() > 11 && (text[10] == 'T' || text[10] == 't') &&
         isDate(text.first(10)) && isTime(text.subspan(11));
}

static bool isDuration(Text text) {
  if (text.size() < 2 || text[0] != 'P')
    return false;
  size_t at = 1;
  bool inTime = false;
  bool sawWeek = false;
  unsigned elements = 0;
  unsigned elementsInTime = 0;
  int rank = -1;
  while (at < text.size()) {
    if (text[at] == 'T') {
      if (inTime)
        return false;
      inTime = true;
      rank = -1;
      ++at;
      continue;
    }
    size_t start = at;
    while (at < text.size() && isASCIIDigit(text[at]))
      ++at;
    if (at == start || at == text.size())
      return false;
    int unit = -1;
    if (inTime) {
      unit = text[at] == 'H'   ? 0
             : text[at] == 'M' ? 1
             : text[at] == 'S' ? 2
                               : -1;
      ++elementsInTime;
    } else if (text[at] == 'W')
      sawWeek = true, unit = 3;
    else
      unit = text[at] == 'Y'   ? 0
             : text[at] == 'M' ? 1
             : text[at] == 'D' ? 2
                               : -1;
    if (unit <= rank)
      return false;
    rank = unit;
    ++elements;
    ++at;
  }
  if (!elements || (inTime && !elementsInTime))
    return false;
  return !sawWeek || elements == 1;
}

static bool isIPv4(Text text) {
  unsigned parts = 0;
  size_t at = 0;
  while (true) {
    size_t start = at;
    unsigned value = 0;
    while (at < text.size() && isASCIIDigit(text[at]) && at - start < 4)
      value = value * 10 + (text[at++] - '0');
    size_t length = at - start;
    if (!length || length > 3 || value > 255 ||
        (length > 1 && text[start] == '0'))
      return false;
    if (++parts == 4)
      return at == text.size();
    if (at >= text.size() || text[at++] != '.')
      return false;
  }
}

static bool isIPv6(Text text) {
  unsigned groups = 0;
  bool sawCompression = false;
  size_t at = 0;
  if (text.size() < 2)
    return false;
  if (text[0] == ':') {
    if (text[1] != ':')
      return false;
    sawCompression = true;
    at = 2;
    if (at == text.size())
      return true;
  }
  while (at < text.size()) {
    size_t start = at;
    while (at < text.size() && isASCIIHexDigit(text[at]))
      ++at;
    size_t length = at - start;
    if (at < text.size() && text[at] == '.') {
      if (!isIPv4(text.subspan(start)))
        return false;
      groups += 2;
      at = text.size();
      break;
    }
    if (!length || length > 4)
      return false;
    ++groups;
    if (at == text.size())
      break;
    if (text[at] != ':')
      return false;
    ++at;
    if (at == text.size())
      return false;
    if (text[at] == ':') {
      if (sawCompression)
        return false;
      sawCompression = true;
      ++at;
      if (at == text.size())
        break;
    }
  }
  return sawCompression ? groups < 8 : groups == 8;
}

static bool isHostname(Text text) {
  if (text.empty() || text.size() > 253)
    return false;
  size_t start = 0;
  for (size_t at = 0; at <= text.size(); ++at) {
    if (at < text.size() && text[at] != '.') {
      if (!isASCIIAlphanumeric(text[at]) && text[at] != '-')
        return false;
      continue;
    }
    size_t length = at - start;
    if (!length || length > 63 || text[start] == '-' || text[at - 1] == '-')
      return false;
    if (length >= 4 && text[start + 2] == '-' && text[start + 3] == '-' &&
        !(isASCIIAlphaCaselessEqual(text[start], 'x') &&
          isASCIIAlphaCaselessEqual(text[start + 1], 'n')))
      return false;
    start = at + 1;
  }
  return true;
}

static bool isEmail(Text text) {
  size_t at = text.size();
  while (at && text[at - 1] != '@')
    --at;
  if (at < 2 || at == text.size())
    return false;
  Text local = text.first(at - 1);
  Text domain = text.subspan(at);
  if (local.size() > 64 && local[0] != '"')
    return false;
  if (local[0] == '"') {
    if (local.size() < 2 || local.back() != '"')
      return false;
    for (size_t i = 1; i + 1 < local.size(); ++i) {
      if (local[i] == '\\') {
        if (++i + 1 >= local.size())
          return false;
      } else if (local[i] == '"' || local[i] < 0x20 || local[i] == 0x7f)
        return false;
    }
  } else {
    bool previousWasDot = true;
    for (char character : local) {
      if (character == '.') {
        if (previousWasDot)
          return false;
        previousWasDot = true;
        continue;
      }
      previousWasDot = false;
      if (isASCIIAlphanumeric(character))
        continue;
      switch (character) {
      case '!':
      case '#':
      case '$':
      case '%':
      case '&':
      case '\'':
      case '*':
      case '+':
      case '-':
      case '/':
      case '=':
      case '?':
      case '^':
      case '_':
      case '`':
      case '{':
      case '|':
      case '}':
      case '~':
        continue;
      default:
        return false;
      }
    }
    if (previousWasDot)
      return false;
  }
  if (domain[0] == '[') {
    if (domain.back() != ']')
      return false;
    Text literal = domain.subspan(1, domain.size() - 2);
    if (literal.size() > 5 && !memcmp(literal.data(), "IPv6:", 5))
      return isIPv6(literal.subspan(5));
    return isIPv4(literal);
  }
  return isHostname(domain);
}

static bool isUnreservedOrSubDelimiter(char character) {
  if (isASCIIAlphanumeric(character))
    return true;
  switch (character) {
  case '-':
  case '.':
  case '_':
  case '~':
  case '!':
  case '$':
  case '&':
  case '\'':
  case '(':
  case ')':
  case '*':
  case '+':
  case ',':
  case ';':
  case '=':
    return true;
  default:
    return false;
  }
}

static bool areURICharacters(Text text, const char *alsoAllowed) {
  for (size_t i = 0; i < text.size(); ++i) {
    char character = text[i];
    if (character == '%') {
      if (i + 2 >= text.size() || !isASCIIHexDigit(text[i + 1]) ||
          !isASCIIHexDigit(text[i + 2]))
        return false;
      i += 2;
      continue;
    }
    if (isUnreservedOrSubDelimiter(character) ||
        (character && strchr(alsoAllowed, character)))
      continue;
    return false;
  }
  return true;
}

static size_t findAny(Text text, const char *characters) {
  for (size_t i = 0; i < text.size(); ++i) {
    if (text[i] && strchr(characters, text[i]))
      return i;
  }
  return text.size();
}

static bool isAuthority(Text text) {
  size_t at = text.size();
  while (at && text[at - 1] != '@')
    --at;
  if (at) {
    if (!areURICharacters(text.first(at - 1), ":"))
      return false;
    text = text.subspan(at);
  }
  if (!text.empty() && text[0] == '[') {
    size_t close = findAny(text, "]");
    if (close == text.size())
      return false;
    Text literal = text.subspan(1, close - 1);
    if (!isIPv6(literal) &&
        !(literal.size() > 2 && (literal[0] == 'v' || literal[0] == 'V')))
      return false;
    text = text.subspan(close + 1);
    if (text.empty())
      return true;
    if (text[0] != ':')
      return false;
  } else {
    size_t colon = findAny(text, ":");
    if (!areURICharacters(text.first(colon), ""))
      return false;
    text = text.subspan(colon);
    if (text.empty())
      return true;
  }
  for (char character : text.subspan(1)) {
    if (!isASCIIDigit(character))
      return false;
  }
  return true;
}

static bool isHierarchicalPart(Text text, bool firstSegmentMayHoldColon) {
  size_t fragment = findAny(text, "#");
  if (fragment != text.size()) {
    if (!areURICharacters(text.subspan(fragment + 1), ":@/?"))
      return false;
    text = text.first(fragment);
  }
  size_t query = findAny(text, "?");
  if (query != text.size()) {
    if (!areURICharacters(text.subspan(query + 1), ":@/?"))
      return false;
    text = text.first(query);
  }
  if (text.size() >= 2 && text[0] == '/' && text[1] == '/') {
    text = text.subspan(2);
    size_t end = findAny(text, "/");
    if (!isAuthority(text.first(end)))
      return false;
    text = text.subspan(end);
  } else if (!firstSegmentMayHoldColon) {
    size_t end = findAny(text, "/");
    if (findAny(text.first(end), ":") != end)
      return false;
  }
  return areURICharacters(text, ":@/");
}

static size_t schemeLength(Text text) {
  if (text.empty() || !isASCIIAlpha(text[0]))
    return 0;
  for (size_t i = 1; i < text.size(); ++i) {
    if (text[i] == ':')
      return i;
    if (!isASCIIAlphanumeric(text[i]) && text[i] != '+' && text[i] != '-' &&
        text[i] != '.')
      return 0;
  }
  return 0;
}

static bool isURI(Text text) {
  size_t scheme = schemeLength(text);
  return scheme && isHierarchicalPart(text.subspan(scheme + 1), true);
}

static bool isURIReference(Text text) {
  if (size_t scheme = schemeLength(text))
    return isHierarchicalPart(text.subspan(scheme + 1), true);
  return isHierarchicalPart(text, false);
}

static bool isUUID(Text text) {
  if (text.size() != 36)
    return false;
  for (size_t i = 0; i < 36; ++i) {
    bool isDash = i == 8 || i == 13 || i == 18 || i == 23;
    if (isDash ? text[i] != '-' : !isASCIIHexDigit(text[i]))
      return false;
  }
  return true;
}

static bool isJSONPointer(StringView view, unsigned from) {
  if (from == view.length())
    return true;
  if (view[from] != '/')
    return false;
  for (unsigned i = from; i < view.length(); ++i) {
    if (view[i] == '~' &&
        (i + 1 == view.length() || (view[i + 1] != '0' && view[i + 1] != '1')))
      return false;
  }
  return true;
}

static bool isRelativeJSONPointer(StringView view) {
  unsigned at = 0;
  while (at < view.length() && isASCIIDigit(view[at]))
    ++at;
  if (!at || (at > 1 && view[0] == '0'))
    return false;
  if (at + 1 == view.length() && view[at] == '#')
    return true;
  return isJSONPointer(view, at);
}

bool matchesFormat(JSC::VM &, Format format, StringView view) {
  switch (format) {
  case Format::RegularExpression: {
    JSC::Yarr::ErrorCode error = JSC::Yarr::ErrorCode::NoError;
    JSC::Yarr::YarrPattern pattern(view, {JSC::Yarr::Flags::Unicode}, error);
    return error == JSC::Yarr::ErrorCode::NoError;
  }
  case Format::JSONPointer:
    return isJSONPointer(view, 0);
  case Format::RelativeJSONPointer:
    return isRelativeJSONPointer(view);
  case Format::URL:
    return URL(view.toString()).isValid();
  default:
    break;
  }

  Vector<char, 256> characters;
  characters.grow(view.length());
  for (unsigned i = 0; i < view.length(); ++i) {
    char16_t character = view[i];
    if (character > 0x7e || character < 0x20)
      return false;
    characters[i] = static_cast<char>(character);
  }
  Text text = characters.span();
  switch (format) {
  case Format::DateTime:
    return isDateTime(text);
  case Format::Date:
    return isDate(text);
  case Format::Time:
    return isTime(text);
  case Format::Duration:
    return isDuration(text);
  case Format::Email:
    return isEmail(text);
  case Format::Hostname:
    return isHostname(text);
  case Format::IPv4:
    return isIPv4(text);
  case Format::IPv6:
    return isIPv6(text);
  case Format::URI:
    return isURI(text);
  case Format::URIReference:
    return isURIReference(text);
  case Format::UUID:
    return isUUID(text);
  default:
    return false;
  }
}

} // namespace Bun::JSONSchema
