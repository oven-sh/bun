optionx(ENABLE_APPLE_CODESIGN BOOL "Enable code signing on macOS" DEFAULT ${CI})

if(NOT ENABLE_APPLE_CODESIGN)
  return()
endif()

find_command(VARIABLE APPLE_CODESIGN_PROGRAM COMMAND codesign REQUIRED)
find_command(VARIABLE APPLE_SECURITY_PROGRAM COMMAND security REQUIRED)
find_command(VARIABLE DITTO_PROGRAM COMMAND ditto REQUIRED)
find_command(VARIABLE SHELL_PROGRAM COMMAND sh bash REQUIRED)

optionx(APPLE_CODESIGN_IDENTITY STRING "Code signing identity on macOS (e.g. 'FRXF46ZSN')" SECRET)

if(NOT APPLE_CODESIGN_IDENTITY)
  message(FATAL_ERROR "Code signing is enabled, but no APPLE_CODESIGN_IDENTITY is set.\n"
    "To fix this, either:\n"
    "  - Set ENABLE_APPLE_CODESIGN=OFF to disable code signing\n"
    "  - Fi"
  )
endif()

optionx(APPLE_CODESIGN_IDENTITY_BASE64 STRING "Base64-encoded code signing identity .p12 file" SECRET)
optionx(APPLE_CODESIGN_IDENTITY_PATH FILEPATH "Path to the code signing identity .p12 file")
optionx(APPLE_CODESIGN_IDENTITY_PASSWORD STRING "Password for the code signing identity .p12 file" DEFAULT "" SECRET)

if(APPLE_CODESIGN_IDENTITY_BASE64 AND APPLE_CODESIGN_IDENTITY_PATH)
  message(FATAL_ERROR "Cannot specify both APPLE_CODESIGN_IDENTITY_BASE64 and APPLE_CODESIGN_IDENTITY_PATH")
endif()

set(DEFAULT_APPLE_KEYCHAIN_PATH $ENV{HOME}/Library/Keychains/login.keychain-db)

if(CI OR NOT EXISTS ${DEFAULT_APPLE_KEYCHAIN_PATH})
  set(DEFAULT_APPLE_KEYCHAIN_PATH ${BUILD_PATH}/bun.keychain-db)
endif()

optionx(APPLE_CODESIGN_KEYCHAIN_PATH FILEPATH "Path to the keychain to use for code signing" DEFAULT ${DEFAULT_APPLE_KEYCHAIN_PATH})
optionx(APPLE_CODESIGN_KEYCHAIN_PASSWORD STRING "Password for the keychain" DEFAULT "" SECRET)

if(NOT EXISTS ${APPLE_CODESIGN_KEYCHAIN_PATH})
  register_command(
    COMMENT
      "Setting up Apple keychain"
    COMMAND
      ${SHELL_PROGRAM} -c
        "echo \"Creating keychain\"
          && ${APPLE_SECURITY_PROGRAM} create-keychain -p \"${APPLE_CODESIGN_KEYCHAIN_PASSWORD}\" ${APPLE_CODESIGN_KEYCHAIN_PATH}
        && echo \"Setting keychain settings\"
          && ${APPLE_SECURITY_PROGRAM} set-keychain-settings -l ${APPLE_CODESIGN_KEYCHAIN_PATH}
        && echo \"Unlocking keychain\"
          && ${APPLE_SECURITY_PROGRAM} unlock-keychain -p \"${APPLE_CODESIGN_KEYCHAIN_PASSWORD}\" ${APPLE_CODESIGN_KEYCHAIN_PATH}
        && echo \"Done\""
    OUTPUTS
      ${APPLE_CODESIGN_KEYCHAIN_PATH}
  )
endif()

if(NOT APPLE_CODESIGN_IDENTITY_BASE64 AND NOT APPLE_CODESIGN_IDENTITY_PATH)
  execute_process(
    COMMAND ${APPLE_SECURITY_PROGRAM} find-identity -v -p codesigning
    OUTPUT_VARIABLE APPLE_CODESIGN_IDENTITY_LIST
  )
  if(NOT APPLE_CODESIGN_IDENTITY_LIST MATCHES "${APPLE_CODESIGN_IDENTITY}")
    message(FATAL_ERROR "Code signing is enabled, but no identity was found in the keychain.\n"
      "To fix this, either:\n"
      "  - Add the identity to the keychain by running 'security add-identity'\n"
      "  - Set APPLE_CODESIGN_IDENTITY_PATH to the path of the .p12 file for the identity\n"
      "  - Set APPLE_CODESIGN_IDENTITY_BASE64 to the base64-encoded .p12 file for the identity\n"
    )
  endif()
endif()

set(IDENTITY_PATH ${BUILD_PATH}/apple-codesign-identity.p12)

if(APPLE_CODESIGN_IDENTITY_BASE64)
  find_command(VARIABLE BASE64_PROGRAM COMMAND base64 REQUIRED)
  register_command(
    COMMENT
      "Decoding base64-encoded code signing identity"
    COMMAND
      ${CMAKE_COMMAND}
        -E echo ${APPLE_CODESIGN_IDENTITY_BASE64}
        | ${BASE64_PROGRAM} --decode > ${IDENTITY_PATH}
    OUTPUTS
      ${IDENTITY_PATH}
  )
else()
  register_command(
    COMMENT
      "Copying code signing identity"
    COMMAND
      ${CMAKE_COMMAND}
        -E copy ${APPLE_CODESIGN_IDENTITY_PATH} ${IDENTITY_PATH}
    OUTPUTS
      ${IDENTITY_PATH}
  )
endif()

register_command(
  TARGET
    apple-codesign-identity
  COMMENT
    "Installing Apple code signing identity"
  SOURCES
    ${IDENTITY_PATH}
    ${APPLE_CODESIGN_KEYCHAIN_PATH}
  COMMAND
    ${SHELL_PROGRAM} -c
      "echo \"Unlocking keychain\"
        && ${APPLE_SECURITY_PROGRAM} unlock-keychain -p \"${APPLE_CODESIGN_KEYCHAIN_PASSWORD}\" ${APPLE_CODESIGN_KEYCHAIN_PATH}
      && echo \"Importing identity\"
        && ${APPLE_SECURITY_PROGRAM} import ${IDENTITY_PATH} -k ${APPLE_CODESIGN_KEYCHAIN_PATH} -P \"${APPLE_CODESIGN_IDENTITY_PASSWORD}\" -T ${APPLE_CODESIGN_PROGRAM}
      && echo \"Setting key partition list\"
        && ${APPLE_SECURITY_PROGRAM} set-key-partition-list -S apple-tool:,apple:,codesign: -s -k \"${APPLE_CODESIGN_KEYCHAIN_PASSWORD}\" ${APPLE_CODESIGN_KEYCHAIN_PATH}
      && echo \"Verifying identity\"
        && ${APPLE_SECURITY_PROGRAM} find-identity -v -p codesigning ${APPLE_CODESIGN_KEYCHAIN_PATH}
      && echo \"Done\""
  ALWAYS_RUN
)
