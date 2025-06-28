# Let the MSVC runtime be set using CMAKE_MSVC_RUNTIME_LIBRARY, instead of automatically.
# Since CMake 3.15.
cmake_policy(SET CMP0091 NEW)

# If INTERPROCEDURAL_OPTIMIZATION is enabled and not supported by the compiler, throw an error.
# Since CMake 3.9.
cmake_policy(SET CMP0069 NEW)

# Use CMAKE_{C,CXX}_STANDARD when evaluating try_compile().
# Since CMake 3.8.
cmake_policy(SET CMP0067 NEW)
