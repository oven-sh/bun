register_repository(
  NAME
    hdrhistogram
  REPOSITORY
    HdrHistogram/HdrHistogram_c
  COMMIT
    652d51bcc36744fd1a6debfeb1a8a5f58b14022c
)

register_cmake_command(
  TARGET
    hdrhistogram
  LIBRARIES
    hdr_histogram
  INCLUDES
    include
)

# Must be loaded after zlib is defined
if(TARGET clone-zlib)
  add_dependencies(hdrhistogram clone-zlib)
endif()