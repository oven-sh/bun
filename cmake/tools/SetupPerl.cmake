if(NOT WIN32)
  return()
endif()

optionx(ENABLE_PERL_DOWNLOAD BOOL "Download a portable Perl for codegen if perl.exe is missing" DEFAULT ON)

find_program(PERL_EXECUTABLE NAMES perl perl.exe)

if(PERL_EXECUTABLE)
  setx(PERL_EXECUTABLE ${PERL_EXECUTABLE})
  setx(PERL_SETUP_TARGETS "")
else()
  if(NOT ENABLE_PERL_DOWNLOAD)
    message(FATAL_ERROR "Perl is required to build Bun (missing: perl.exe). Install Perl or set ENABLE_PERL_DOWNLOAD=ON.")
  endif()

  # Source: https://strawberryperl.com/releases.json
  # Note: this is intentionally a hardcoded x86_64 Strawberry Perl URL.
  # Windows ARM64 can run x86_64 binaries via WoW64 emulation, and no native ARM64 Strawberry Perl build exists yet.
  # This can later be replaced with architecture detection using CMAKE_SYSTEM_PROCESSOR (similar to Zig/WebKit/LLVM).
  set(PERL_PORTABLE_URL "https://github.com/StrawberryPerl/Perl-Dist-Strawberry/releases/download/SP_54001_64bit_UCRT/strawberry-perl-5.40.0.1-64bit-portable.zip")
  set(PERL_SHA256 "754F3E2A8E473DC68D1540C7802FB166A025F35EF18960C4564A31F8B5933907")
  setx(PERL_PATH ${CACHE_PATH}/perl)
  setx(PERL_EXECUTABLE ${PERL_PATH}/perl/bin/perl.exe)

  register_command(
    TARGET
      clone-perl
    COMMENT
      "Downloading Perl"
    COMMAND
      ${CMAKE_COMMAND}
        -DPERL_PATH=${PERL_PATH}
        -DPERL_URL=${PERL_PORTABLE_URL}
        -DPERL_SHA256=${PERL_SHA256}
        -P ${CWD}/cmake/scripts/DownloadPerl.cmake
    SOURCES
      ${CWD}/cmake/scripts/DownloadPerl.cmake
    OUTPUTS
      ${PERL_EXECUTABLE}
  )

  setx(PERL_SETUP_TARGETS clone-perl)
endif()

setx(BUN_PERL_ENV "BUN_PERL=${PERL_EXECUTABLE}")
