optionx(ENABLE_CCACHE BOOL "If ccache should be enabled" DEFAULT ON)

if(NOT ENABLE_CCACHE OR CACHE_STRATEGY STREQUAL "none")
  setenv(CCACHE_DISABLE 1)
  return()
endif()


find_command(
  VARIABLE
    CCACHE_PROGRAM
  COMMAND
    ccache
)

if(NOT CCACHE_PROGRAM)
  return()
endif()

set(CCACHE_ARGS CMAKE_C_COMPILER_LAUNCHER CMAKE_CXX_COMPILER_LAUNCHER)
foreach(arg ${CCACHE_ARGS})
  setx(${arg} ${CCACHE_PROGRAM})
  list(APPEND CMAKE_ARGS -D${arg}=${${arg}})
endforeach()

setenv(CCACHE_DIR ${CACHE_PATH}/ccache)
setenv(CCACHE_BASEDIR ${CWD})
setenv(CCACHE_NOHASHDIR 1)

if(CACHE_STRATEGY STREQUAL "read-only")
  setenv(CCACHE_READONLY 1)
elseif(CACHE_STRATEGY STREQUAL "write-only")
  setenv(CCACHE_RECACHE 1)
endif()

setenv(CCACHE_FILECLONE 1)
setenv(CCACHE_STATSLOG ${BUILD_PATH}/ccache.log)

if(CI)
  # FIXME: Does not work on Ubuntu 18.04
  # setenv(CCACHE_SLOPPINESS "pch_defines,time_macros,locale,clang_index_store,gcno_cwd,include_file_ctime,include_file_mtime")
else()
  setenv(CCACHE_MAXSIZE 100G)
  setenv(CCACHE_SLOPPINESS "pch_defines,time_macros,locale,random_seed,clang_index_store,gcno_cwd")
endif()



