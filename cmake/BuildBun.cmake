

set(BUN_DEPENDENCIES_SOURCE ${CWD}/src/deps)
set(BUN_USOCKETS_SOURCE ${CWD}/packages/bun-usockets)

file(GLOB BUN_CPP_SOURCES ${CONFIGURE_DEPENDS}
  ${CWD}/src/io/*.cpp
  ${CWD}/src/bun.js/modules/*.cpp
  ${CWD}/src/bun.js/bindings/*.cpp
  ${CWD}/src/bun.js/bindings/webcore/*.cpp
  ${CWD}/src/bun.js/bindings/sqlite/*.cpp
  ${CWD}/src/bun.js/bindings/webcrypto/*.cpp
  ${CWD}/src/bun.js/bindings/webcrypto/*/*.cpp
  ${CWD}/src/bun.js/bindings/v8/*.cpp
  ${BUN_USOCKETS_SOURCE}/src/*.c
  ${BUN_USOCKETS_SOURCE}/src/eventing/*.c
  ${BUN_USOCKETS_SOURCE}/src/internal/*.c
  ${BUN_USOCKETS_SOURCE}/src/crypto/*.c
  ${BUN_USOCKETS_SOURCE}/src/crypto/*.cpp
  # TODO: Keep this for now, but it's dubious if we actually need it
  ${BUN_DEPENDENCIES_SOURCE}/picohttpparser/picohttpparser.c
  ${BUN_DEPENDENCIES_SOURCE}/*.cpp
)

list(APPEND BUN_CPP_SOURCES
  ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
  ${BUN_JS_SINK_OUTPUTS}
  ${BUN_JAVASCRIPT_OUTPUTS}
  ${BUN_OBJECT_LUT_OUTPUTS}
)

if(WIN32)
  list(APPEND BUN_CPP_SOURCES ${CWD}/src/bun.js/bindings/windows/musl-memmem.c)
endif()

if(WIN32)
  set(BUN_ICO_PATH ${CWD}/src/bun.ico)
  if(ENABLE_CANARY)
    set(Bun_VERSION_WITH_TAG "${USE_VERSION}-canary.${USE_CANARY_REVISION}")
  else()
    set(Bun_VERSION_WITH_TAG "${USE_VERSION}")
  endif()

  # Does string interpolation with CMake variables, then copies the file
  configure_file(
    ${CWD}/src/windows-app-info.rc
    ${BUILD_PATH}/CMakeFiles/windows-app-info.rc
  )

  list(APPEND BUN_CPP_SOURCES ${BUILD_PATH}/CMakeFiles/windows-app-info.rc)
endif()

if(BUN_CPP_ARCHIVE)
  add_link_options(${BUN_CPP_ARCHIVE})
endif()

if(NOT BUN_CPP_ONLY)
  add_executable(${bun} ${BUN_CPP_SOURCES} ${ZIG_OBJECT_PATH})
else()
  add_library(${bun} STATIC ${BUN_CPP_SOURCES})
  set_target_properties(${bun} PROPERTIES OUTPUT_NAME bun)
endif()

include(RunClangTidy)
include(RunCppCheck)
include(RunIWYU)
include(RunCppLint)
