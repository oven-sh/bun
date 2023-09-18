# Fuzz-testing of various parsers, mocked examples and system libraries

A secure web server must be capable of receiving mass amount of malicious input without misbehaving or performing illegal actions, such as stepping outside of a memory block or otherwise spilling the beans.

### Continuous fuzzing under various sanitizers is done as part of the [Google OSS-Fuzz](https://github.com/google/oss-fuzz#oss-fuzz---continuous-fuzzing-for-open-source-software) project:
* UndefinedBehaviorSanitizer
* AddressSanitizer
* MemorySanitizer

### Overall coverage is about 95% for both uSockets and uWebSockets, all source code included
* No defects or outstanding bugs
* No timeouts, OOM, crashes or other issues
* Transparent reporting of found issues: https://bugs.chromium.org/p/oss-fuzz/issues/list?q=label%3AProj-uwebsockets&can=1

### Currently the following parts are individually fuzzed:

* WebSocket handshake generator
* WebSocket message parser
* WebSocket extensions parser & negotiator
* WebSocket permessage-deflate compression/inflation helper
* Http parser (with and without Proxy Protocol v2)
* Http method/url router
* Pub/sub "topic tree"

### While some targets are entire (mocked) example apps
* libEpollFuzzer mocks the kernel syscalls and allows to cover a lot of uSockets source code.
* A mock implementation of uSockets allows to cover a lot of the inbetween logic of uWebSockets.
