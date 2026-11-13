// Included in front of Dawn's Objective-C++ files. bun links no framework, so that only a program that asks for a GPU loads Metal.

#pragma once

// Classes are looked up by name.
#pragma clang attribute push(__attribute__((objc_runtime_visible)), apply_to = objc_interface)
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <QuartzCore/QuartzCore.h>
#pragma clang attribute pop

// Its format is a string literal, which refers to a class.
#define NSLog(...) ((void)0)

#define FUNCTION(library, name)
#define DATA(library, name, size) static_assert(sizeof(name) == size);
#import <IOKit/IOKitLib.h>
#import <IOSurface/IOSurfaceRef.h>
#include "MetalSymbols.def"
#undef FUNCTION
#undef DATA
