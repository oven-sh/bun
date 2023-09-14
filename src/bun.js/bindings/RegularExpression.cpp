#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/RegularExpression.h"

using namespace JSC;
using namespace JSC::Yarr;

extern "C" RegularExpression* Yarr__RegularExpression__init(BunString pattern, uint16_t flags)
{
    return new RegularExpression(Bun::toWTFString(pattern), OptionSet<Flags>(static_cast<Flags>(flags)));
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
extern "C" int Yarr__RegularExpression__searchRev(RegularExpression* re, BunString string)
{
    return re->searchRev(Bun::toWTFString(string));
}
// extern "C" int Yarr__RegularExpression__match(RegularExpression* re, BunString string, int32_t start, int32_t* matchLength)
// {
//     return re->match(Bun::toWTFString(string), start, matchLength);
// }
extern "C" int Yarr__RegularExpression__matches(RegularExpression* re, BunString string)
{
    return re->match(Bun::toWTFString(string), 0, 0);
}