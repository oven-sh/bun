#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/RegularExpression.h>

using namespace JSC;
using namespace JSC::Yarr;

extern "C" RegularExpression* Yarr__RegularExpression__init(const BunString* pattern, uint16_t flags)
{
    return new RegularExpression(pattern->toWTFString(BunString::ZeroCopy), OptionSet<Flags>(static_cast<Flags>(flags)));
}
extern "C" void Yarr__RegularExpression__deinit(RegularExpression* re)
{
    delete re;
}
extern "C" bool Yarr__RegularExpression__isValid(RegularExpression* re)
{
    return re->isValid();
}
extern "C" int Yarr__RegularExpression__matchedLength(RegularExpression* re)
{
    return re->matchedLength();
}
extern "C" int Yarr__RegularExpression__matches(RegularExpression* re, const BunString* string)
{
    return re->match(string->toWTFString(BunString::ZeroCopy), 0, 0);
}
