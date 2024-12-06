if(CI)
  set(DEFAULT_ENABLE_CODESIGN ${CMAKE_SYSTEM_NAME})
else()
  set(DEFAULT_ENABLE_CODESIGN "OFF")
endif()

optionx(ENABLE_CODESIGN STRING "Enable code signing" DEFAULT ${DEFAULT_ENABLE_CODESIGN})

if(ENABLE_CODESIGN STREQUAL "ON" OR ENABLE_CODESIGN MATCHES "Darwin")
  find_command(VARIABLE SECURITY_PROGRAM COMMAND security REQUIRED)
  find_command(VARIABLE CODESIGN_PROGRAM COMMAND codesign REQUIRED)
  find_command(VARIABLE DITTO_PROGRAM COMMAND ditto REQUIRED)

  optionx(APPLE_CODESIGN_KEYCHAIN_PATH FILEPATH "Path to the keychain to use for code signing" DEFAULT ${BUILD_PATH}/apple-codesign-keychain.db)
  optionx(APPLE_CODESIGN_KEYCHAIN_PASSWORD STRING "Password for the keychain" DEFAULT "" SECRET)
  get_filename_component(APPLE_CODESIGN_KEYCHAIN_FILENAME ${APPLE_CODESIGN_KEYCHAIN_PATH} NAME)

  if(NOT EXISTS ${APPLE_CODESIGN_KEYCHAIN_PATH})
    execute_process(
      COMMAND ${SECURITY_PROGRAM} create-keychain -p "${APPLE_CODESIGN_KEYCHAIN_PASSWORD}" ${APPLE_CODESIGN_KEYCHAIN_PATH}
      OUTPUT_QUIET
      ERROR_VARIABLE CREATE_KEYCHAIN_ERROR
      ERROR_STRIP_TRAILING_WHITESPACE
    )

    if(CREATE_KEYCHAIN_ERROR)
      message(FATAL_ERROR "Failed to create keychain ${APPLE_CODESIGN_KEYCHAIN_FILENAME}: ${CREATE_KEYCHAIN_ERROR}")
    endif()

    execute_process(
      COMMAND ${SECURITY_PROGRAM} set-keychain-settings -l ${APPLE_CODESIGN_KEYCHAIN_PATH}
      OUTPUT_QUIET
      ERROR_VARIABLE SET_KEYCHAIN_SETTINGS_ERROR
      ERROR_STRIP_TRAILING_WHITESPACE
    )

    if(SET_KEYCHAIN_SETTINGS_ERROR)
      message(FATAL_ERROR "Failed to set keychain settings for ${APPLE_CODESIGN_KEYCHAIN_FILENAME}: ${SET_KEYCHAIN_SETTINGS_ERROR}")
    endif()
  endif()

  execute_process(
    COMMAND ${SECURITY_PROGRAM} unlock-keychain -p "${APPLE_CODESIGN_KEYCHAIN_PASSWORD}" ${APPLE_CODESIGN_KEYCHAIN_PATH}
    OUTPUT_QUIET
    ERROR_VARIABLE UNLOCK_KEYCHAIN_ERROR
    ERROR_STRIP_TRAILING_WHITESPACE
  )

  if(UNLOCK_KEYCHAIN_ERROR)
    message(FATAL_ERROR "Failed to unlock keychain ${APPLE_CODESIGN_KEYCHAIN_FILENAME}: ${UNLOCK_KEYCHAIN_ERROR}")
  endif()

  optionx(APPLE_CODESIGN_IDENTITY STRING "Code signing identity on macOS (e.g. 'FRXF46ZSN')" SECRET)

  if(NOT APPLE_CODESIGN_IDENTITY)
    message(FATAL_ERROR "Code signing is enabled, but no APPLE_CODESIGN_IDENTITY is set.\n"
      "To fix this, either:\n"
      "  - Set ENABLE_CODESIGN=OFF to disable code signing\n"
      "  - Find your identity in your keychain and set APPLE_CODESIGN_IDENTITY to the identity's name\n"
    )
  endif()

  optionx(APPLE_CODESIGN_IDENTITY_BASE64 STRING "Base64-encoded code signing identity .p12 file" SECRET)
  optionx(APPLE_CODESIGN_IDENTITY_PATH FILEPATH "Path to the code signing identity .p12 file")

  if(APPLE_CODESIGN_IDENTITY_BASE64)
    find_command(VARIABLE BASE64_PROGRAM COMMAND base64 REQUIRED)
    setx(APPLE_CODESIGN_IDENTITY_PATH ${BUILD_PATH}/apple-codesign-identity.p12)
    execute_process(
      COMMAND ${CMAKE_COMMAND} -E echo ${APPLE_CODESIGN_IDENTITY_BASE64} | ${BASE64_PROGRAM} --decode > ${APPLE_CODESIGN_IDENTITY_PATH}
      OUTPUT_QUIET
      ERROR_VARIABLE DECODE_IDENTITY_ERROR
      ERROR_STRIP_TRAILING_WHITESPACE
    )

    if(DECODE_IDENTITY_ERROR)
      message(FATAL_ERROR "Failed to decode base64 identity: ${DECODE_IDENTITY_ERROR}")
    endif()
  endif()

  optionx(APPLE_CODESIGN_IDENTITY_PASSWORD STRING "Password for the code signing identity .p12 file" DEFAULT "" SECRET)

  execute_process(
    COMMAND ${SECURITY_PROGRAM} find-identity -v -p codesigning ${APPLE_CODESIGN_KEYCHAIN_PATH}
    OUTPUT_VARIABLE FIND_IDENTITY_OUTPUT
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_VARIABLE FIND_IDENTITY_ERROR
    ERROR_STRIP_TRAILING_WHITESPACE
  )

  if(FIND_IDENTITY_ERROR)
    message(FATAL_ERROR "Failed to find identity ${APPLE_CODESIGN_IDENTITY} in keychain ${APPLE_CODESIGN_KEYCHAIN_FILENAME}: ${FIND_IDENTITY_ERROR}")
  endif()

  if(NOT FIND_IDENTITY_OUTPUT MATCHES "${APPLE_CODESIGN_IDENTITY}")
    if(NOT APPLE_CODESIGN_IDENTITY_BASE64 AND NOT APPLE_CODESIGN_IDENTITY_PATH)
      message(FATAL_ERROR "Code signing is enabled, but no identity was found in your keychain.\n"
        "To fix this, either:\n"
        "  - Add the identity to your keychain by running 'security import [identity-path] -k [keychain-path] -T ${CODESIGN_PROGRAM}'\n"
        "  - Set APPLE_CODESIGN_IDENTITY_PATH to the path of the .p12 file for the identity\n"
        "  - Set APPLE_CODESIGN_IDENTITY_BASE64 to the base64-encoded .p12 file for the identity\n"
      )
    endif()

    execute_process(
      COMMAND ${SECURITY_PROGRAM} import ${APPLE_CODESIGN_IDENTITY_PATH} -k ${APPLE_CODESIGN_KEYCHAIN_PATH} -P "${APPLE_CODESIGN_IDENTITY_PASSWORD}" -T ${CODESIGN_PROGRAM}
      OUTPUT_QUIET
      ERROR_VARIABLE IMPORT_IDENTITY_ERROR
      ERROR_STRIP_TRAILING_WHITESPACE
    )

    if(IMPORT_IDENTITY_ERROR)
      message(FATAL_ERROR "Failed to import identity ${APPLE_CODESIGN_IDENTITY_PATH}: ${IMPORT_IDENTITY_ERROR}")
    endif()

    execute_process(
      COMMAND ${SECURITY_PROGRAM} set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "${APPLE_CODESIGN_KEYCHAIN_PASSWORD}" ${APPLE_CODESIGN_KEYCHAIN_PATH}
      OUTPUT_QUIET
      ERROR_VARIABLE SET_KEY_PARTITION_LIST_ERROR
      ERROR_STRIP_TRAILING_WHITESPACE
    )

    if(SET_KEY_PARTITION_LIST_ERROR)
      message(FATAL_ERROR "Failed to set key partition list for ${APPLE_CODESIGN_KEYCHAIN_FILENAME}: ${SET_KEY_PARTITION_LIST_ERROR}")
    endif()

    execute_process(
      COMMAND ${SECURITY_PROGRAM} find-identity -v -p codesigning ${APPLE_CODESIGN_KEYCHAIN_PATH}
      OUTPUT_VARIABLE FIND_IDENTITY_OUTPUT
      OUTPUT_STRIP_TRAILING_WHITESPACE
      ERROR_VARIABLE FIND_IDENTITY_ERROR
      ERROR_STRIP_TRAILING_WHITESPACE
    )

    if(FIND_IDENTITY_ERROR)
      message(FATAL_ERROR "Failed to find identity ${APPLE_CODESIGN_IDENTITY} in keychain ${APPLE_CODESIGN_KEYCHAIN_FILENAME}: ${FIND_IDENTITY_ERROR}")
    endif()

    if(NOT FIND_IDENTITY_OUTPUT MATCHES "${APPLE_CODESIGN_IDENTITY}")
      message(FATAL_ERROR "Failed to find identity ${APPLE_CODESIGN_IDENTITY}, but it was successfully imported?")
    endif()
  endif()
endif()

if(ENABLE_CODESIGN STREQUAL "ON" OR ENABLE_CODESIGN MATCHES "Windows")
  # TODO: Implement code signing for Windows
endif()
