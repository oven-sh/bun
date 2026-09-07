/**
 * WTF file lists for the WebKit source build (deps/webkit.ts): what
 * WebKit's cmake would compile, generate and install for the JSCOnly port
 * with bun's options, written out (Source/WTF/wtf/CMakeLists.txt +
 * PlatformJSCOnly.cmake: WTF_SOURCES per OS, WTF_PRIVATE_INCLUDE_DIRECTORIES).
 * Paths are relative to Source/WTF/wtf.
 *
 * Maintained by hand on a WebKit bump: a file added, removed or renamed
 * upstream shows up as "no such file" at compile time or an undefined /
 * duplicate symbol at link; fix the list (.claude/commands/upgrade-webkit.md
 * says which cmake variable maps to which list).
 */

import type { Config } from "../config.ts";

/** WTF_SOURCES shared by every target (relative to Source/WTF/wtf). */
export const wtfSourcesCommon: readonly string[] = [
  "ASCIICType.cpp",
  "ApproximateTime.cpp",
  "Assertions.cpp",
  "AutomaticThread.cpp",
  "AvailableMemory.cpp",
  "uv_get_constrained_memory.cpp",
  "BitVector.cpp",
  "BloomFilter.cpp",
  "CPUTime.cpp",
  "ClockType.cpp",
  "CodePtr.cpp",
  "CompactPtr.cpp",
  "CompilationThread.cpp",
  "ConcurrentBuffer.cpp",
  "ConcurrentPtrHashSet.cpp",
  "ContinuousApproximateTime.cpp",
  "ContinuousTime.cpp",
  "CountingLock.cpp",
  "CrossThreadCopier.cpp",
  "CrossThreadTaskHandler.cpp",
  "CryptographicUtilities.cpp",
  "CryptographicallyRandomNumber.cpp",
  "CurrentThread.cpp",
  "CurrentTime.cpp",
  "DataLog.cpp",
  "DateMath.cpp",
  "DebugHeap.cpp",
  "EmbeddedFixedVector.cpp",
  "FastBitVector.cpp",
  "FastFloat.cpp",
  "FastMalloc.cpp",
  "FileHandle.cpp",
  "FilePrintStream.cpp",
  "FileSystem.cpp",
  "FunctionDispatcher.cpp",
  "GlobalVersion.cpp",
  "GregorianDateTime.cpp",
  "HashTable.cpp",
  "HexNumber.cpp",
  "Int128.cpp",
  "JSONValues.cpp",
  "Language.cpp",
  "LikelyDenseUnsignedIntegerSet.cpp",
  "Lock.cpp",
  "LockedPrintStream.cpp",
  "LogChannels.cpp",
  "LogInitialization.cpp",
  "Logger.cpp",
  "Logging.cpp",
  "MainThread.cpp",
  "MainThreadDispatcher.cpp",
  "MallocCommon.cpp",
  "MediaTime.cpp",
  "MemoryPressureHandler.cpp",
  "MetaAllocator.cpp",
  "MonotonicTime.cpp",
  "NativePromise.cpp",
  "NumberOfCores.cpp",
  "OSRandomSource.cpp",
  "ObjectIdentifier.cpp",
  "PageBlock.cpp",
  "ParallelHelperPool.cpp",
  "ParallelJobsGeneric.cpp",
  "ParkingLot.cpp",
  "PreciseSum.cpp",
  "PrintStream.cpp",
  "ProcessPrivilege.cpp",
  "RAMSize.cpp",
  "RandomDevice.cpp",
  "ReadWriteLock.cpp",
  "RefCountDebugger.cpp",
  "RefTrackerMixin.cpp",
  "RunLoop.cpp",
  "RuntimeApplicationChecks.cpp",
  "SHA1.cpp",
  "SIMDUTF.cpp",
  "SafeStrerror.cpp",
  "Seconds.cpp",
  "SegmentedVector.cpp",
  "SequesteredAllocator.cpp",
  "SequesteredAutomaticThread.cpp",
  "SequesteredImmortalHeap.cpp",
  "SequesteredMalloc.cpp",
  "SixCharacterHash.cpp",
  "SmallSet.cpp",
  "StackBounds.cpp",
  "StackCheck.cpp",
  "StackPointer.cpp",
  "StackStats.cpp",
  "StackTrace.cpp",
  "StringPrintStream.cpp",
  "SuspendableWorkQueue.cpp",
  "ThreadGroup.cpp",
  "ThreadMessage.cpp",
  "Threading.cpp",
  "TimeWithDynamicClockType.cpp",
  "TimeZone.cpp",
  "TimingScope.cpp",
  "URL.cpp",
  "URLHelpers.cpp",
  "URLParser.cpp",
  "UUID.cpp",
  "UnbarrieredMonotonicTime.cpp",
  "UniqueArray.cpp",
  "Vector.cpp",
  "WTFAssertions.cpp",
  "WTFConfig.cpp",
  "WTFProcess.cpp",
  "WallTime.cpp",
  "WeakPtr.cpp",
  "WeakRandomNumber.cpp",
  "WordLock.cpp",
  "WorkQueue.cpp",
  "WorkerPool.cpp",
  "dtoa.cpp",
  "dragonbox/dragonbox_to_chars.cpp",
  "dtoa/bignum-dtoa.cc",
  "dtoa/bignum.cc",
  "dtoa/cached-powers.cc",
  "dtoa/diy-fp.cc",
  "dtoa/double-conversion.cc",
  "dtoa/fast-dtoa.cc",
  "dtoa/fixed-dtoa.cc",
  "dtoa/strtod.cc",
  "persistence/PersistentCoders.cpp",
  "persistence/PersistentDecoder.cpp",
  "persistence/PersistentEncoder.cpp",
  "text/ASCIILiteral.cpp",
  "text/AtomString.cpp",
  "text/AtomStringImpl.cpp",
  "text/AtomStringTable.cpp",
  "text/Base64.cpp",
  "text/CString.cpp",
  "text/CStringView.cpp",
  "text/ExternalStringImpl.cpp",
  "text/LineEnding.cpp",
  "text/StringBuffer.cpp",
  "text/StringBuilder.cpp",
  "text/StringBuilderJSON.cpp",
  "text/StringCommon.cpp",
  "text/StringImpl.cpp",
  "text/StringView.cpp",
  "text/SymbolImpl.cpp",
  "text/SymbolRegistry.cpp",
  "text/TextBreakIterator.cpp",
  "text/TextStream.cpp",
  "text/UniquedStringImpl.cpp",
  "text/WTFString.cpp",
  "text/icu/UnicodeExtras.cpp",
  "text/icu/UTextProvider.cpp",
  "text/icu/UTextProviderLatin1.cpp",
  "text/icu/UTextProviderUTF16.cpp",
  "threads/BinarySemaphore.cpp",
  "threads/Signals.cpp",
  "unicode/CollatorDefault.cpp",
  "unicode/UTF8Conversion.cpp",
  "unicode/icu/CollatorICU.cpp",
  "unicode/icu/ICUHelpers.cpp",
  "generic/WorkQueueGeneric.cpp",
  "bun/RunLoopBun.cpp",
];

/** PlatformJSCOnly.cmake's non-Windows block: every unix target compiles these. */
export const wtfSourcesPosix: readonly string[] = [
  "generic/MainThreadGeneric.cpp",
  "posix/OSAllocatorPOSIX.cpp",
  "posix/ThreadingPOSIX.cpp",
  "text/unix/TextBreakIteratorInternalICUUnix.cpp",
  "unix/LanguageUnix.cpp",
  "posix/CPUTimePOSIX.cpp",
  "posix/FileHandlePOSIX.cpp",
  "posix/FileSystemPOSIX.cpp",
  "posix/MappedFileDataPOSIX.cpp",
  "unix/UniStdExtrasUnix.cpp",
];

/** WTF_SOURCES that Source/WTF/wtf/PlatformJSCOnly.cmake picks per OS. */
export function wtfSourcesFor(cfg: Config): string[] {
  if (cfg.windows) {
    return [
      "text/win/StringWin.cpp",
      "text/win/TextBreakIteratorInternalICUWin.cpp",
      "win/CPUTimeWin.cpp",
      "win/DbgHelperWin.cpp",
      "win/FileHandleWin.cpp",
      "win/FileSystemWin.cpp",
      "win/LanguageWin.cpp",
      "win/LoggingWin.cpp",
      "win/MainThreadWin.cpp",
      "win/MappedFileDataWin.cpp",
      "win/OSAllocatorWin.cpp",
      "win/PathWalker.cpp",
      "win/SignalsWin.cpp",
      "win/ThreadingWin.cpp",
      "win/WTFCRTDebug.cpp",
      "win/Win32Handle.cpp",
      "win/MemoryFootprintWin.cpp",
      "win/MemoryPressureHandlerWin.cpp",
    ];
  }
  if (cfg.abi === "android") {
    return [
      ...wtfSourcesPosix,
      "android/LoggingAndroid.cpp",
      "android/RefPtrAndroid.cpp",
      "linux/CurrentProcessMemoryStatus.cpp",
      "linux/HighPriorityThreads.cpp",
      "linux/MemoryFootprintLinux.cpp",
      "generic/MemoryPressureHandlerGeneric.cpp",
    ];
  }
  if (cfg.freebsd) {
    return [
      ...wtfSourcesPosix,
      "unix/LoggingUnix.cpp",
      "generic/MemoryFootprintGeneric.cpp",
      "unix/MemoryPressureHandlerUnix.cpp",
    ];
  }
  if (cfg.darwin) {
    // + the two MIG-generated mach_exc stubs, added by the emitter.
    // Two WTF_SOURCES entries are left out. A prebuilt libWTF.a got away with
    // listing them because nothing ever pulled those members out of the
    // archive; here every object is on the link line.
    // - cocoa/TimeZoneCocoa.cpp: with USE(BUN_JSC_ADDITIONS) TimeZone.cpp
    //   already defines listenForTimeZoneChangeNotifications() (bun bumps
    //   the time-zone ID itself), so the Cocoa notifier is a duplicate
    //   definition that also drags in CoreFoundation, which bun deliberately
    //   does not link.
    // - darwin/OSLogPrintStream.mm: only referenced under PLATFORM(COCOA)
    //   (JSC's useOSLog option, Integrity logging), never by the JSCOnly
    //   port; it is ARC, so linking it would pull in the Objective-C runtime
    //   for nothing.
    return [
      ...wtfSourcesPosix,
      "unix/LoggingUnix.cpp",
      "cocoa/MemoryFootprintCocoa.cpp",
      "generic/MemoryPressureHandlerGeneric.cpp",
    ];
  }
  // linux (gnu, musl)
  return [
    ...wtfSourcesPosix,
    "unix/LoggingUnix.cpp",
    "linux/CurrentProcessMemoryStatus.cpp",
    "linux/HighPriorityThreads.cpp",
    "linux/MemoryFootprintLinux.cpp",
    "unix/MemoryPressureHandlerUnix.cpp",
  ];
}

/** WTF_PRIVATE_INCLUDE_DIRECTORIES inside the tree (relative to Source/WTF/wtf: "." is that directory, ".." is Source/WTF for <wtf/X.h>). */
export const wtfIncludeDirs: readonly string[] = [
  "..",
  ".",
  "dtoa",
  "fast_float",
  "persistence",
  "simdutf",
  "text",
  "text/icu",
  "threads",
  "unicode",
];
