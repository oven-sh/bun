#!/usr/bin/env bun
"use strict" as any;
console.log("under a cast, behind a hashbang:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
