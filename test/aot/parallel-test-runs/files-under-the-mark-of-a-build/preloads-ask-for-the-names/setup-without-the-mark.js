(globalThis.seenByPreloads ??= []).push([typeof jest, typeof expect, typeof describe, typeof vi, typeof test, typeof beforeEach].join(" "));
