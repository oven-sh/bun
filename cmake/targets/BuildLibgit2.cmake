register_repository(
  NAME
    libgit2
  REPOSITORY
    libgit2/libgit2
  TAG
    v1.9.0
)

register_cmake_command(
  TARGET
    libgit2
  TARGETS
    libgit2package
  ARGS
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON
    -DBUILD_SHARED_LIBS=OFF
    -DBUILD_TESTS=OFF
    -DBUILD_CLI=OFF
    -DBUILD_EXAMPLES=OFF
    -DBUILD_FUZZERS=OFF
    # Network disabled - local operations only
    -DUSE_HTTPS=OFF
    -DUSE_SSH=OFF
    # Use bundled dependencies to avoid symbol conflicts with Bun's libraries
    -DUSE_BUNDLED_ZLIB=ON
    -DUSE_HTTP_PARSER=builtin
    -DREGEX_BACKEND=builtin
    -DUSE_SHA1=CollisionDetection
    # Enable threading
    -DUSE_THREADS=ON
    # Disable authentication features (not needed for local operations)
    -DUSE_GSSAPI=OFF
  LIB_PATH
    .
  LIBRARIES
    git2
  INCLUDES
    include
)
