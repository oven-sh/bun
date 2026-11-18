#include "Test.h"

static String wide(std::u16string_view text) { return std::span { text.data(), text.size() }; }

TEST(ParseInteger)
{
    EXPECT(parseInteger<uint16_t>(" +65535\v"_s) == 65535 && !parseInteger<uint16_t>("65536"_s) && !parseInteger<uint16_t>("-0"_s) && !parseInteger<uint16_t>("1x"_s));
    EXPECT(!parseInteger<uint16_t>(" 1"_s, 10, WTF::ParseIntegerWhitespacePolicy::Disallow) && !parseInteger<int>(StringView()) && parseInteger<int>(wide(u"-fF"), 16) == -255);
    EXPECT(parseIntegerAllowingTrailingJunk<int64_t>("-9223372036854775808;"_s) == INT64_MIN && !parseIntegerAllowingTrailingJunk<int64_t>("9223372036854775808"_s));
    EXPECT(parseInteger<unsigned>("755"_span8, 8, WTF::TrailingJunkPolicy::Disallow) == 0755u && !parseInteger<unsigned>("8"_span8, 8, WTF::TrailingJunkPolicy::Disallow));
}

TEST(Base64)
{
    auto decoded = [](StringView text) { return base64URLDecode(text).transform([](auto&& bytes) { return String { byteCast<Latin1Character>(bytes.span()) }; }); };
    EXPECT(decoded("YWI"_s) == "ab"_str && decoded("YWI===="_s) == "ab"_str && decoded(wide(u"YQ")) == "a"_str && decoded("-_8"_s) == wide(u"\u00fb\u00ff"));
    EXPECT(base64URLDecode(""_s)->isEmpty() && !decoded("="_s) && !decoded("Y"_s) && !decoded("Y=Q"_s) && !decoded("YW I"_s) && !decoded("YWJj\n\n"_s) && !decoded("+/8"_s) && !decoded(wide(u"Y\u0141")));
    EXPECT(base64Decode(asByteSpan("+/8="_span))->size() == 2 && !base64Decode(asByteSpan("-_8="_span)));
    EXPECT(base64EncodeToString(asByteSpan("a"_span)) == "YQ=="_s && base64EncodeToString({}) == ""_s);
}

TEST(Dates)
{
    EXPECT(parseDate("Tue, 09 Nov 1999 23:12:40 GMT"_span8) == 942189160000 && std::isnan(parseDate("never"_span8)));
    EXPECT(timeClip(-0.5) == 0 && !std::signbit(timeClip(-0.5)) && std::isnan(timeClip(8.64e15 + 1)) && jsCurrentTime() == std::floor(jsCurrentTime()));
    EXPECT(WTF::canonicalTimeZone("America/Anchorage"_s) == "America/Anchorage"_s && WTF::canonicalTimeZone("Nowhere"_s).isEmpty() && !WTF::setTimeZoneOverride("Nowhere"_s));
    EXPECT(!PlainGregorianDateTime());
}

TEST(JSONValues)
{
    auto value = JSON::Value::parseJSON(" {\"a\":1,\"b\":[true,null,-2.5e1,\"\\u20ac\\x41\\v\\/\"],\"c\":{},\"a\":\"last\"} "_s);
    EXPECT(value->toJSONString() == wide(u"{\"a\":\"last\",\"b\":[true,null,-25,\"\u20acA\\u000b/\"],\"c\":{}}"));
    auto object = value->asObject();
    EXPECT(object->getString("a"_s) == "last"_s && !object->getInteger("a"_s) && object->getObject("c"_s) && !object->getArray("c"_s) && !object->getValue("d"_s));
    EXPECT(object->getArray("b"_s)->get(2)->asInteger() == -25 && object->getArray("b"_s)->get(0)->asBoolean() == true && !value->asArray());
    EXPECT(JSON::Value::create(1e99)->asInteger() == INT_MAX && JSON::Value::create(std::nan(""))->toJSONString() == "null"_s);
    for (auto invalid : { ""_s, "[1,]"_s, "{\"a\":1,}"_s, "01"_s, "1."_s, "1e"_s, "\"a"_s, "\"\\"_s, "\"\\u12\""_s, "\"\\q\""_s, "nul"_s, "1 2"_s, "{1:2}"_s })
        EXPECT(!JSON::Value::parseJSON(invalid));

    auto nested = [](unsigned depth) { return JSON::Value::parseJSON(String::fromLatin1((std::string(depth, '[') + std::string(depth, ']')).c_str())); };
    EXPECT(nested(1001) && !nested(1002));

    auto names = JSON::ArrayOf<String>::create();
    names->addItem("x"_s);
    auto built = JSON::Object::create();
    built->setArray("names"_s, WTF::move(names));
    built->setInteger("n"_s, 7);
    EXPECT(built->toJSONString() == "{\"names\":[\"x\"],\"n\":7}"_s);
}

TEST(URLParts)
{
    URL url { "https://us%20er:pa%ffss@example.com:8080/a/b?q=1#f"_str };
    EXPECT(url.isValid() && url.protocol() == "https"_s && url.encodedUser() == "us%20er"_s && url.user() == "us er"_s && url.encodedPassword() == "pa%ffss"_s && url.password().isNull());
    EXPECT(url.host() == "example.com"_s && url.port() == 8080 && url.hostAndPort() == "example.com:8080"_s && url.protocolHostAndPort() == "https://example.com:8080"_s);
    EXPECT(url.path() == "/a/b"_s && url.query() == "q=1"_s && url.queryWithLeadingQuestionMark() == "?q=1"_s && url.fragmentIdentifier() == "f"_s);
    EXPECT(url.protocolIsInHTTPFamily() && url.hasSpecialScheme() && url.hasCredentials() && !url.protocolIsFile() && url.fileSystemPath().isNull());
    EXPECT(URL(url, "../c"_s).path() == "/c"_s && URL(url, String()).string() == "https://us%20er:pa%ffss@example.com:8080/a/b?q=1"_s);

    URL plain { "a:b"_str };
    EXPECT(plain.hasOpaquePath() && plain.query().isNull() && plain.fragmentIdentifier().isNull() && plain.encodedPassword().isNull() && !plain.port() && plain.host() == ""_s);

    URL invalid { wide(u"\u20ac") };
    EXPECT(!invalid.isValid() && invalid.string() == wide(u"\u20ac") && invalid.host().isNull() && invalid.path().isNull() && !invalid.protocolIs(""_s));
    EXPECT(URL().isNull() && URL(String()).isNull() && !URL(""_str).isNull());

    URL moved = WTF::move(url);
    EXPECT(moved.isValid() && !url.isValid() && url.isNull() && moved.isolatedCopy() == moved);

    URL file = URL::fileURLWithFileSystemPath(wide(u"/a b/\u20ac#?"));
    EXPECT(file.string() == "file:///a%20b/%E2%82%AC%23%3F"_s && file.fileSystemPath() == wide(u"/a b/\u20ac#?"));
}

TEST(URLEncodedForms)
{
    auto form = WTF::URLParser::tryParseURLEncodedForm("a=1+2&&b&=%E2%82%AC"_s, 1024);
    EXPECT(form->size() == 3 && form->at(0).value == "1 2"_s && form->at(1).key == "b"_s && form->at(2).value == wide(u"\u20ac"));
    form->append({ "c"_s, String() });
    EXPECT(WTF::URLParser::serialize(*form) == "a=1+2&b=&=%E2%82%AC&c="_s && WTF::URLParser::serialize({}).isNull());
    EXPECT(WTF::URLParser::tryParseURLEncodedForm(""_s, 0)->isEmpty() && !WTF::URLParser::tryParseURLEncodedForm("a&b"_s, 16));
}
