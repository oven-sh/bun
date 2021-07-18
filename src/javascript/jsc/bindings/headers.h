#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>


/**** DefaultGlobal /*****/

#ifndef BINDINGS__decls__DefaultGlobal_h
#define BINDINGS__decls__DefaultGlobal_h
#include "DefaultGlobal.h"
namespace Wundle {
 class DefaultGlobal;
}
#endif

extern "C" JSC::ObjectPrototype* DefaultGlobal__objectPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::FunctionPrototype* DefaultGlobal__functionPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::ArrayPrototype* DefaultGlobal__arrayPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::JSObject* DefaultGlobal__booleanPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::StringPrototype* DefaultGlobal__stringPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::JSObject* DefaultGlobal__numberPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::BigIntPrototype* DefaultGlobal__bigIntPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::JSObject* DefaultGlobal__datePrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::JSObject* DefaultGlobal__symbolPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::RegExpPrototype* DefaultGlobal__regExpPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::JSObject* DefaultGlobal__errorPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::IteratorPrototype* DefaultGlobal__iteratorPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::AsyncIteratorPrototype* DefaultGlobal__asyncIteratorPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::GeneratorFunctionPrototype* DefaultGlobal__generatorFunctionPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::GeneratorPrototype* DefaultGlobal__generatorPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::AsyncFunctionPrototype* DefaultGlobal__asyncFunctionPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::ArrayIteratorPrototype* DefaultGlobal__arrayIteratorPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::MapIteratorPrototype* DefaultGlobal__mapIteratorPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::SetIteratorPrototype* DefaultGlobal__setIteratorPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::JSObject* DefaultGlobal__mapPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::JSObject* DefaultGlobal__jsSetPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::JSPromisePrototype* DefaultGlobal__promisePrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::AsyncGeneratorPrototype* DefaultGlobal__asyncGeneratorPrototype(Wundle::DefaultGlobal* arg0);
extern "C" JSC::AsyncGeneratorFunctionPrototype* DefaultGlobal__asyncGeneratorFunctionPrototype(Wundle::DefaultGlobal* arg0);

/***** DefaultGlobal *****/