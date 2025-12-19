# Misctools - standalone utilities for testing and benchmarking

# cold-jsc-start: A minimal JSC cold start benchmark tool
# This tool measures JSC initialization overhead.
#
# Build with: cmake --build build/release --target cold-jsc-start
# Usage: ./cold-jsc-start -e "write('hello')"
#        ./cold-jsc-start <file.js>

if(NOT WIN32 AND NOT BUN_LINK_ONLY AND NOT BUN_CPP_ONLY)
  set(COLD_JSC_WEBKIT_PATH ${WEBKIT_PATH})

  if(EXISTS ${COLD_JSC_WEBKIT_PATH}/lib/libJavaScriptCore.a)
    message(STATUS "cold-jsc-start will use WebKit from: ${COLD_JSC_WEBKIT_PATH}")

    add_executable(cold-jsc-start EXCLUDE_FROM_ALL
      ${CWD}/misctools/cold-jsc-start.cpp
    )

    set_target_properties(cold-jsc-start PROPERTIES
      CXX_STANDARD 23
      CXX_STANDARD_REQUIRED YES
      CXX_EXTENSIONS YES
      CXX_VISIBILITY_PRESET hidden
      VISIBILITY_INLINES_HIDDEN YES
      INCLUDE_DIRECTORIES ""
    )

    # Use same include directories as bun
    target_include_directories(cold-jsc-start BEFORE PRIVATE
      ${COLD_JSC_WEBKIT_PATH}/include
      ${CWD}/src/bun.js/bindings
    )

    # Use same compile definitions as bun
    target_compile_definitions(cold-jsc-start PRIVATE
      _HAS_EXCEPTIONS=0
      BUILDING_JSCONLY__
      STATICALLY_LINKED_WITH_JavaScriptCore=1
      STATICALLY_LINKED_WITH_BMALLOC=1
      BUILDING_WITH_CMAKE=1
      JSC_OBJC_API_ENABLED=0
      USE_BUN_JSC_ADDITIONS=1
    )

    # Use same compile options as bun (from BuildBun.cmake)
    if(NOT WIN32)
      target_compile_options(cold-jsc-start PRIVATE
        -fconstexpr-steps=2542484
        -fconstexpr-depth=54
        -fno-pic
        -fno-pie
        -faddrsig
      )
    endif()

    target_link_libraries(cold-jsc-start PRIVATE
      ${COLD_JSC_WEBKIT_PATH}/lib/libJavaScriptCore.a
      ${COLD_JSC_WEBKIT_PATH}/lib/libWTF.a
    )

    if(EXISTS ${COLD_JSC_WEBKIT_PATH}/lib/libbmalloc.a)
      target_link_libraries(cold-jsc-start PRIVATE ${COLD_JSC_WEBKIT_PATH}/lib/libbmalloc.a)
    endif()

    if(APPLE)
      target_link_libraries(cold-jsc-start PRIVATE icucore resolv)
      target_compile_definitions(cold-jsc-start PRIVATE
        U_DISABLE_RENAMING=1
        _DARWIN_NON_CANCELABLE=1
      )
      target_link_options(cold-jsc-start PRIVATE
        -Wl,-ld_new
        -Wl,-no_compact_unwind
        -Wl,-w
        -fno-keep-static-consts
      )
    endif()

    if(LINUX)
      target_link_libraries(cold-jsc-start PRIVATE
        ${COLD_JSC_WEBKIT_PATH}/lib/libicui18n.a
        ${COLD_JSC_WEBKIT_PATH}/lib/libicuuc.a
        ${COLD_JSC_WEBKIT_PATH}/lib/libicudata.a
        pthread
        dl
      )
      target_link_options(cold-jsc-start PRIVATE -no-pie)
      if(USE_STATIC_LIBATOMIC)
        target_link_libraries(cold-jsc-start PRIVATE libatomic.a)
      else()
        target_link_libraries(cold-jsc-start PRIVATE atomic)
      endif()
    endif()
  # bench-jsc-e2e: Single E2E cold start benchmark
  add_executable(bench-jsc-e2e EXCLUDE_FROM_ALL
    ${CWD}/misctools/bench-jsc-e2e.cpp
  )
  set_target_properties(bench-jsc-e2e PROPERTIES
    CXX_STANDARD 23
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS YES
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN YES
    INCLUDE_DIRECTORIES ""
  )
  target_include_directories(bench-jsc-e2e BEFORE PRIVATE
    ${COLD_JSC_WEBKIT_PATH}/include
    ${CWD}/src/bun.js/bindings
  )
  target_compile_definitions(bench-jsc-e2e PRIVATE
    _HAS_EXCEPTIONS=0
    BUILDING_JSCONLY__
    STATICALLY_LINKED_WITH_JavaScriptCore=1
    STATICALLY_LINKED_WITH_BMALLOC=1
    BUILDING_WITH_CMAKE=1
    JSC_OBJC_API_ENABLED=0
    USE_BUN_JSC_ADDITIONS=1
  )
  if(NOT WIN32)
    target_compile_options(bench-jsc-e2e PRIVATE
      -fconstexpr-steps=2542484
      -fconstexpr-depth=54
      -fno-pic
      -fno-pie
      -faddrsig
    )
  endif()
  target_link_libraries(bench-jsc-e2e PRIVATE
    ${COLD_JSC_WEBKIT_PATH}/lib/libJavaScriptCore.a
    ${COLD_JSC_WEBKIT_PATH}/lib/libWTF.a
  )
  if(EXISTS ${COLD_JSC_WEBKIT_PATH}/lib/libbmalloc.a)
    target_link_libraries(bench-jsc-e2e PRIVATE ${COLD_JSC_WEBKIT_PATH}/lib/libbmalloc.a)
  endif()
  if(APPLE)
    target_link_libraries(bench-jsc-e2e PRIVATE icucore resolv)
    target_compile_definitions(bench-jsc-e2e PRIVATE
      U_DISABLE_RENAMING=1
      _DARWIN_NON_CANCELABLE=1
    )
    target_link_options(bench-jsc-e2e PRIVATE
      -Wl,-ld_new
      -Wl,-no_compact_unwind
      -Wl,-w
      -fno-keep-static-consts
    )
  endif()
  if(LINUX)
    target_link_libraries(bench-jsc-e2e PRIVATE
      ${COLD_JSC_WEBKIT_PATH}/lib/libicui18n.a
      ${COLD_JSC_WEBKIT_PATH}/lib/libicuuc.a
      ${COLD_JSC_WEBKIT_PATH}/lib/libicudata.a
      pthread dl atomic
    )
    target_link_options(bench-jsc-e2e PRIVATE -no-pie)
  endif()

  # bench-jsc-100-e2e: 100 VMs + GlobalObjects + eval
  add_executable(bench-jsc-100-e2e EXCLUDE_FROM_ALL
    ${CWD}/misctools/bench-jsc-100-e2e.cpp
  )
  set_target_properties(bench-jsc-100-e2e PROPERTIES
    CXX_STANDARD 23
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS YES
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN YES
    INCLUDE_DIRECTORIES ""
  )
  target_include_directories(bench-jsc-100-e2e BEFORE PRIVATE
    ${COLD_JSC_WEBKIT_PATH}/include
    ${CWD}/src/bun.js/bindings
  )
  target_compile_definitions(bench-jsc-100-e2e PRIVATE
    _HAS_EXCEPTIONS=0
    BUILDING_JSCONLY__
    STATICALLY_LINKED_WITH_JavaScriptCore=1
    STATICALLY_LINKED_WITH_BMALLOC=1
    BUILDING_WITH_CMAKE=1
    JSC_OBJC_API_ENABLED=0
    USE_BUN_JSC_ADDITIONS=1
  )
  if(NOT WIN32)
    target_compile_options(bench-jsc-100-e2e PRIVATE
      -fconstexpr-steps=2542484
      -fconstexpr-depth=54
      -fno-pic
      -fno-pie
      -faddrsig
    )
  endif()
  target_link_libraries(bench-jsc-100-e2e PRIVATE
    ${COLD_JSC_WEBKIT_PATH}/lib/libJavaScriptCore.a
    ${COLD_JSC_WEBKIT_PATH}/lib/libWTF.a
  )
  if(EXISTS ${COLD_JSC_WEBKIT_PATH}/lib/libbmalloc.a)
    target_link_libraries(bench-jsc-100-e2e PRIVATE ${COLD_JSC_WEBKIT_PATH}/lib/libbmalloc.a)
  endif()
  if(APPLE)
    target_link_libraries(bench-jsc-100-e2e PRIVATE icucore resolv)
    target_compile_definitions(bench-jsc-100-e2e PRIVATE
      U_DISABLE_RENAMING=1
      _DARWIN_NON_CANCELABLE=1
    )
    target_link_options(bench-jsc-100-e2e PRIVATE
      -Wl,-ld_new
      -Wl,-no_compact_unwind
      -Wl,-w
      -fno-keep-static-consts
    )
  endif()
  if(LINUX)
    target_link_libraries(bench-jsc-100-e2e PRIVATE
      ${COLD_JSC_WEBKIT_PATH}/lib/libicui18n.a
      ${COLD_JSC_WEBKIT_PATH}/lib/libicuuc.a
      ${COLD_JSC_WEBKIT_PATH}/lib/libicudata.a
      pthread dl atomic
    )
    target_link_options(bench-jsc-100-e2e PRIVATE -no-pie)
  endif()

  # bench-jsc-multi-eval: Multi-script eval benchmark
  add_executable(bench-jsc-multi-eval EXCLUDE_FROM_ALL
    ${CWD}/misctools/bench-jsc-multi-eval.cpp
  )
  set_target_properties(bench-jsc-multi-eval PROPERTIES
    CXX_STANDARD 23
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS YES
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN YES
    INCLUDE_DIRECTORIES ""
  )
  target_include_directories(bench-jsc-multi-eval BEFORE PRIVATE
    ${COLD_JSC_WEBKIT_PATH}/include
    ${CWD}/src/bun.js/bindings
  )
  target_compile_definitions(bench-jsc-multi-eval PRIVATE
    _HAS_EXCEPTIONS=0
    BUILDING_JSCONLY__
    STATICALLY_LINKED_WITH_JavaScriptCore=1
    STATICALLY_LINKED_WITH_BMALLOC=1
    BUILDING_WITH_CMAKE=1
    JSC_OBJC_API_ENABLED=0
    USE_BUN_JSC_ADDITIONS=1
  )
  if(NOT WIN32)
    target_compile_options(bench-jsc-multi-eval PRIVATE
      -fconstexpr-steps=2542484
      -fconstexpr-depth=54
      -fno-pic
      -fno-pie
      -faddrsig
    )
  endif()
  target_link_libraries(bench-jsc-multi-eval PRIVATE
    ${COLD_JSC_WEBKIT_PATH}/lib/libJavaScriptCore.a
    ${COLD_JSC_WEBKIT_PATH}/lib/libWTF.a
  )
  if(EXISTS ${COLD_JSC_WEBKIT_PATH}/lib/libbmalloc.a)
    target_link_libraries(bench-jsc-multi-eval PRIVATE ${COLD_JSC_WEBKIT_PATH}/lib/libbmalloc.a)
  endif()
  if(APPLE)
    target_link_libraries(bench-jsc-multi-eval PRIVATE icucore resolv)
    target_compile_definitions(bench-jsc-multi-eval PRIVATE
      U_DISABLE_RENAMING=1
      _DARWIN_NON_CANCELABLE=1
    )
    target_link_options(bench-jsc-multi-eval PRIVATE
      -Wl,-ld_new
      -Wl,-no_compact_unwind
      -Wl,-w
      -fno-keep-static-consts
    )
  endif()
  if(LINUX)
    target_link_libraries(bench-jsc-multi-eval PRIVATE
      ${COLD_JSC_WEBKIT_PATH}/lib/libicui18n.a
      ${COLD_JSC_WEBKIT_PATH}/lib/libicuuc.a
      ${COLD_JSC_WEBKIT_PATH}/lib/libicudata.a
      pthread dl atomic
    )
    target_link_options(bench-jsc-multi-eval PRIVATE -no-pie)
  endif()

  else()
    message(STATUS "cold-jsc-start target disabled: WebKit not found")
  endif()
endif()

# V8 benchmark tools for comparison with JSC
#
# Build with: cmake --build build/release --target cold-v8-start bench-v8-e2e bench-v8-100-e2e bench-v8-multi-eval
#
# V8 is searched in this order:
# 1. V8_PATH environment variable or CMake variable (for custom/static builds)
# 2. macOS: Homebrew /opt/homebrew/opt/v8
# 3. Linux: pkg-config or /usr/local, /usr
#
# For static linking, build V8 from source:
#   cd vendor/node/deps/v8
#   tools/dev/gm.py x64.release
#   Then set V8_PATH to the output directory

set(V8_FOUND FALSE)
set(V8_STATIC FALSE)

# Check for custom V8 path first (allows static builds)
if(DEFINED ENV{V8_PATH})
  set(V8_PATH "$ENV{V8_PATH}")
elseif(NOT DEFINED V8_PATH)
  set(V8_PATH "")
endif()

# Try custom path first
if(V8_PATH AND EXISTS ${V8_PATH}/include/v8.h)
  set(V8_FOUND TRUE)
  set(V8_INCLUDE_DIRS ${V8_PATH}/include)

  # Prefer static libraries
  if(EXISTS ${V8_PATH}/lib/libv8_monolith.a)
    # Monolithic static build (recommended for embedding)
    set(V8_STATIC TRUE)
    set(V8_LIBRARIES ${V8_PATH}/lib/libv8_monolith.a)
    message(STATUS "V8 benchmarks will use static V8 monolith from: ${V8_PATH}")
  elseif(EXISTS ${V8_PATH}/lib/libv8.a)
    set(V8_STATIC TRUE)
    set(V8_LIBRARIES
      ${V8_PATH}/lib/libv8.a
      ${V8_PATH}/lib/libv8_libplatform.a
      ${V8_PATH}/lib/libv8_libbase.a
    )
    message(STATUS "V8 benchmarks will use static V8 from: ${V8_PATH}")
  else()
    set(V8_LIBRARY_DIRS ${V8_PATH}/lib)
    set(V8_LIBRARIES v8 v8_libplatform v8_libbase)
    set(V8_RPATH "${V8_PATH}/lib")
    message(STATUS "V8 benchmarks will use V8 from: ${V8_PATH}")
  endif()
  set(V8_DEFINITIONS V8_COMPRESS_POINTERS V8_31BIT_SMIS_ON_64BIT_ARCH V8_ENABLE_SANDBOX)
endif()

# macOS: Try Homebrew
if(NOT V8_FOUND AND APPLE)
  set(V8_HOMEBREW_PATH "/opt/homebrew/opt/v8")
  if(EXISTS ${V8_HOMEBREW_PATH}/include/v8.h)
    set(V8_FOUND TRUE)
    set(V8_INCLUDE_DIRS ${V8_HOMEBREW_PATH}/include)
    set(V8_LIBRARY_DIRS ${V8_HOMEBREW_PATH}/lib)
    set(V8_LIBRARIES v8 v8_libplatform v8_libbase)
    set(V8_RPATH "${V8_HOMEBREW_PATH}/libexec")
    set(V8_DEFINITIONS V8_COMPRESS_POINTERS V8_31BIT_SMIS_ON_64BIT_ARCH V8_ENABLE_SANDBOX)
    message(STATUS "V8 benchmarks will use Homebrew V8 from: ${V8_HOMEBREW_PATH} (dynamic)")
  endif()
endif()

# Linux: Try pkg-config or standard paths
if(NOT V8_FOUND AND LINUX)
  find_package(PkgConfig QUIET)
  if(PkgConfig_FOUND)
    pkg_check_modules(V8_PKG QUIET v8 v8_libplatform)
    if(V8_PKG_FOUND)
      set(V8_FOUND TRUE)
      set(V8_INCLUDE_DIRS ${V8_PKG_INCLUDE_DIRS})
      set(V8_LIBRARY_DIRS ${V8_PKG_LIBRARY_DIRS})
      set(V8_LIBRARIES ${V8_PKG_LIBRARIES})
      set(V8_DEFINITIONS V8_COMPRESS_POINTERS V8_31BIT_SMIS_ON_64BIT_ARCH)
      message(STATUS "V8 benchmarks will use system V8 via pkg-config (dynamic)")
    endif()
  endif()

  if(NOT V8_FOUND)
    foreach(V8_SEARCH_PATH /usr/local /usr)
      if(EXISTS ${V8_SEARCH_PATH}/include/v8.h OR EXISTS ${V8_SEARCH_PATH}/include/v8/v8.h)
        set(V8_FOUND TRUE)
        if(EXISTS ${V8_SEARCH_PATH}/include/v8/v8.h)
          set(V8_INCLUDE_DIRS ${V8_SEARCH_PATH}/include/v8)
        else()
          set(V8_INCLUDE_DIRS ${V8_SEARCH_PATH}/include)
        endif()
        # Prefer static
        if(EXISTS ${V8_SEARCH_PATH}/lib/libv8_monolith.a)
          set(V8_STATIC TRUE)
          set(V8_LIBRARIES ${V8_SEARCH_PATH}/lib/libv8_monolith.a)
        elseif(EXISTS ${V8_SEARCH_PATH}/lib/libv8.a)
          set(V8_STATIC TRUE)
          set(V8_LIBRARIES
            ${V8_SEARCH_PATH}/lib/libv8.a
            ${V8_SEARCH_PATH}/lib/libv8_libplatform.a
          )
        else()
          set(V8_LIBRARY_DIRS ${V8_SEARCH_PATH}/lib)
          set(V8_LIBRARIES v8 v8_libplatform)
        endif()
        set(V8_DEFINITIONS V8_COMPRESS_POINTERS V8_31BIT_SMIS_ON_64BIT_ARCH V8_ENABLE_SANDBOX)
        if(V8_STATIC)
          message(STATUS "V8 benchmarks will use static V8 from: ${V8_SEARCH_PATH}")
        else()
          message(STATUS "V8 benchmarks will use V8 from: ${V8_SEARCH_PATH} (dynamic)")
        endif()
        break()
      endif()
    endforeach()
  endif()
endif()

if(V8_FOUND)
  # Helper function to set up V8 benchmark targets
  function(add_v8_benchmark TARGET_NAME SOURCE_FILE)
    add_executable(${TARGET_NAME} EXCLUDE_FROM_ALL ${SOURCE_FILE})
    set_target_properties(${TARGET_NAME} PROPERTIES
      CXX_STANDARD 20
      CXX_STANDARD_REQUIRED YES
    )
    target_include_directories(${TARGET_NAME} PRIVATE ${V8_INCLUDE_DIRS})
    target_compile_definitions(${TARGET_NAME} PRIVATE ${V8_DEFINITIONS})
    if(V8_LIBRARY_DIRS)
      target_link_directories(${TARGET_NAME} PRIVATE ${V8_LIBRARY_DIRS})
    endif()
    target_link_libraries(${TARGET_NAME} PRIVATE ${V8_LIBRARIES})
    if(V8_STATIC)
      # Static V8 needs these system libraries
      if(APPLE)
        target_link_libraries(${TARGET_NAME} PRIVATE pthread dl)
      elseif(LINUX)
        target_link_libraries(${TARGET_NAME} PRIVATE pthread dl rt atomic)
        # Use lld linker to handle V8's chromium-built objects
        target_link_options(${TARGET_NAME} PRIVATE -fuse-ld=lld)
      endif()
    elseif(V8_RPATH)
      set_target_properties(${TARGET_NAME} PROPERTIES
        INSTALL_RPATH "${V8_RPATH}"
        BUILD_WITH_INSTALL_RPATH TRUE
      )
    endif()
  endfunction()

  add_v8_benchmark(cold-v8-start ${CWD}/misctools/cold-v8-start.cpp)
  add_v8_benchmark(bench-v8-e2e ${CWD}/misctools/bench-v8-e2e.cpp)
  add_v8_benchmark(bench-v8-100-e2e ${CWD}/misctools/bench-v8-100-e2e.cpp)
  add_v8_benchmark(bench-v8-multi-eval ${CWD}/misctools/bench-v8-multi-eval.cpp)

else()
  message(STATUS "V8 benchmarks disabled: V8 not found")
  message(STATUS "  To enable: set V8_PATH to a V8 build directory, or:")
  message(STATUS "  - macOS: brew install v8")
  message(STATUS "  - Linux: apt install libv8-dev, or build from source")
endif()
