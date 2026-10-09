// C/C++ XML parsers for the `xml_parse` criterion bench to compare against.
// Built by scripts/bench-json-rust.sh when the libraries are available.

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#ifdef HAVE_PUGIXML
#include "pugixml.hpp"
extern "C" void* mi_malloc(size_t);
extern "C" void mi_free(void*);
extern "C" size_t bench_pugixml_parse(const char* data, size_t len)
{
    // Same allocator as the Rust side (glibc's mmap threshold otherwise makes pugixml's
    // numbers depend on heap history more than on pugixml).
    static bool init = (pugi::set_memory_management_functions(mi_malloc, mi_free), true);
    (void)init;
    pugi::xml_document doc;
    // load_buffer copies; pugixml parses in situ on its own copy (its normal mode of use).
    pugi::xml_parse_result r = doc.load_buffer(data, len, pugi::parse_default | pugi::parse_ws_pcdata, pugi::encoding_utf8);
    return r ? 1 : 0;
}
#endif

#ifdef HAVE_EXPAT
#include <expat.h>
static void XMLCALL onStart(void* u, const XML_Char*, const XML_Char** atts)
{
    size_t* n = (size_t*)u;
    for (size_t i = 0; atts[i]; i += 2) *n += 1;
    *n += 1;
}
static void XMLCALL onEnd(void* u, const XML_Char*) { *(size_t*)u += 1; }
static void XMLCALL onText(void* u, const XML_Char*, int len) { *(size_t*)u += (size_t)len; }
extern "C" size_t bench_expat_parse(const char* data, size_t len)
{
    size_t n = 0;
    XML_Parser p = XML_ParserCreate(NULL);
    XML_SetUserData(p, &n);
    XML_SetElementHandler(p, onStart, onEnd);
    XML_SetCharacterDataHandler(p, onText);
    int ok = XML_Parse(p, data, (int)len, 1) == XML_STATUS_OK;
    XML_ParserFree(p);
    return ok ? n + 1 : 0;
}
#endif

#ifdef HAVE_LIBXML2
#include <libxml/parser.h>
extern "C" size_t bench_libxml2_parse(const char* data, size_t len)
{
    xmlDocPtr doc = xmlReadMemory(data, (int)len, "bench.xml", NULL, XML_PARSE_NONET);
    if (!doc) return 0;
    xmlFreeDoc(doc);
    return 1;
}
#endif
