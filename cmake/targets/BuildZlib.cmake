include(BuildLibrary)
include(GitClone)

# TODO: make a patch upstream to change the line
# `#ifdef _MSC_VER`
# to account for clang-cl, which implements `__builtin_ctzl` and `__builtin_expect`
# $textToReplace = [regex]::Escape("int __inline __builtin_ctzl(unsigned long mask)") + "[^}]*}"
# $fileContent = Get-Content "deflate.h" -Raw
# if ($fileContent -match $textToReplace) {
#   Set-Content -Path "deflate.h" -Value ($fileContent -replace $textToReplace, "")
# }
# else {
#   throw "Failed to patch deflate.h"
# }

if(WIN32)
  set(ZLIB_LIBRARY zlib)
else()
  set(ZLIB_LIBRARY z)
endif()

add_custom_library(
  TARGET
    zlib
  LIBRARIES
    ${ZLIB_LIBRARY}
  INCLUDES
    .
  CMAKE_TARGETS
    zlib
  CMAKE_ARGS
    -DBUILD_SHARED_LIBS=OFF
    -DBUILD_EXAMPLES=OFF
    # https://gitlab.kitware.com/cmake/cmake/-/issues/25755
    -DCMAKE_C_FLAGS=\"-fno-define-target-os-macros\"
)

add_custom_clone(
  REPOSITORY
    cloudflare/zlib
  COMMIT
    886098f3f339617b4243b286f5ed364b9989e245
)
