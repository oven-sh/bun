register_vendor_target(mimalloc)

register_repository(
  NAME
    ${mimalloc}
  REPOSITORY
    oven-sh/mimalloc
  COMMIT
    4c283af60cdae205df5a872530c77e2a6a307d43
)

register_cmake_project(
  TARGET
    ${mimalloc}
  CMAKE_TARGETS
    mimalloc-static
    mimalloc-obj
)

register_cmake_definitions(
  TARGET ${mimalloc}
  MI_BUILD_STATIC=ON
  MI_BUILD_OBJECT=ON
  MI_BUILD_SHARED=OFF
  MI_BUILD_TESTS=OFF
  MI_USE_CXX=ON
  MI_OVERRIDE=OFF
  MI_OSX_ZONE=OFF
  MI_OSX_INTERPOSE=OFF
  MI_SKIP_COLLECT_ON_EXIT=ON
)

if(ENABLE_ASSERTIONS)
  register_cmake_definitions(
    TARGET ${mimalloc}
    MI_DEBUG_FULL=ON
    MI_SHOW_ERRORS=ON
  )
  if(ENABLE_VALGRIND)
    register_cmake_definitions(
      TARGET ${mimalloc}
      MI_VALGRIND=ON
    )
  endif()
endif()

# Workaround for linker issue on macOS and Linux x64
# https://github.com/microsoft/mimalloc/issues/512
if(APPLE OR (LINUX AND NOT DEBUG))
  register_libraries(
    TARGET ${mimalloc}
    PATH CMakeFiles/mimalloc-obj.dir/src
    static.c.o
  )
else()
  register_libraries(
    TARGET ${mimalloc}
    mimalloc-static-debug ${WIN32} AND ${DEBUG}
    mimalloc-static       ${WIN32} AND ${RELEASE}
    mimalloc-debug        ${UNIX} AND ${DEBUG}
    mimalloc              ${UNIX} AND ${RELEASE}
  )
endif()
