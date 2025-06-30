#include <emscripten/bind.h>

using namespace emscripten;

class HelloClass {
    public:
    static std::string SayHello(const std::string &name) {
        return "Yo! " + name;
    };
};

EMSCRIPTEN_BINDINGS(Hello) {
    emscripten::class_<HelloClass>("HelloClass")
        .constructor<>()
        .class_function("SayHello", &HelloClass::SayHello);
}
