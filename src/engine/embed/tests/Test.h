#pragma once

#include "engine/Support.h"

#include <cstdio>

namespace Test {

struct Case {
    Case(const char* name, void (*run)());

    const char* name;
    void (*run)();
    Case* next;
};

void fail(const char* file, int line, const char* text);

// Runs the code in a child process.
bool crashes(const ScopedLambda<void()>&);

}

#define TEST(name)                                     \
    static void test##name();                          \
    static Test::Case case##name{ #name, test##name }; \
        static void test##name()

#define EXPECT(...)                                       \
    do {                                                  \
        if (!(__VA_ARGS__))                               \
            Test::fail(__FILE__, __LINE__, #__VA_ARGS__); \
    } while (0)

#define EXPECT_CRASH(...) EXPECT(Test::crashes([&] { __VA_ARGS__; }))
