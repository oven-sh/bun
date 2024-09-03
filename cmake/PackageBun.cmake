include(Macros)

if(bunStrip)
  set(bunStripExe ${bunStrip}${CMAKE_EXECUTABLE_SUFFIX})
  add_target(
    NAME
      bun
    COMMENT
      "Stripping ${bun}"
    COMMAND
      ${CMAKE_STRIP}
        ${bunExe}
        --strip-all
        --strip-debug
        --discard-all
        -o ${bunStripExe}
    WORKING_DIRECTORY
      ${BUILD_PATH}
    OUTPUTS
      ${BUILD_PATH}/${bunStripExe}.1 # FIXME
    DEPENDS
      ${bun}
  )
endif()

add_target(
  NAME
    ${bun}
  ALIASES
    bun
  COMMENT
    "Building ${bun}"
  COMMAND
    ${CMAKE_COMMAND}
      -E env BUN_DEBUG_QUIET_LOGS=1
      ${BUILD_PATH}/${bunExe}
        --revision
  WORKING_DIRECTORY
    ${BUILD_PATH}
  OUTPUTS
    ${BUILD_PATH}/${bunExe}.1 # FIXME
  DEPENDS
    ${bun}
)

set(BUN_FEATURES_SCRIPT ${CWD}/scripts/features.mjs)

add_target(
  NAME
    ${bun}-features
  ALIASES
    bun-features
  COMMENT
    "Generating features.json"
  COMMAND
    ${CMAKE_COMMAND}
      -E env
        BUN_GARBAGE_COLLECTOR_LEVEL=1
        BUN_DEBUG_QUIET_LOGS=1
        BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1
      ${BUILD_PATH}/${bunExe}
      ${BUN_FEATURES_SCRIPT}
  WORKING_DIRECTORY
    ${BUILD_PATH}
  SOURCES
    ${BUN_FEATURES_SCRIPT}
  DEPENDS
    ${bun}
  ARTIFACTS
    ${BUILD_PATH}/features.json
)

if(APPLE)
  add_target(
    NAME
      ${bun}-dsym
    ALIASES
      bun-dsym
    COMMENT
      "Generating ${bun}.dSYM"
    COMMAND
      ${CMAKE_DSYMUTIL}
        ${bun}
        --flat
        --keep-function-for-static
        --object-prefix-map .=${CWD}
        -o ${bun}.dSYM
        -j ${CMAKE_BUILD_PARALLEL_LEVEL}
    WORKING_DIRECTORY
      ${BUILD_PATH}
    DEPENDS
      ${bun}
    ARTIFACTS
      ${BUILD_PATH}/${bun}.dSYM
  )
endif()

foreach(bun ${buns})
  string(REPLACE bun ${bunTriplet} bunPath ${bun})

  set(bunFiles ${bunExe})
  set(bunDeps ${bun})
  if(DEFINED bunStrip AND NOT bunStrip STREQUAL ${bun})
    if(APPLE)
      list(APPEND bunFiles ${bun}.dSYM)
      list(APPEND bunDeps ${bun}-dsym)
    elseif(WIN32)
      list(APPEND bunFiles ${bun}.pdb)
    endif()
  endif()

  add_target(
    NAME
      ${bun}-zip
    COMMENT
      "Generating ${bunPath}.zip"
    COMMAND
      ${CMAKE_COMMAND} -E rm -rf ${bunPath} ${bunPath}.zip
        && ${CMAKE_COMMAND} -E make_directory ${bunPath}
        && ${CMAKE_COMMAND} -E copy ${bunFiles} ${bunPath}
        && ${CMAKE_COMMAND} -E tar cfv ${bunPath}.zip --format=zip ${bunPath}
        && ${CMAKE_COMMAND} -E rm -rf ${bunPath}
    WORKING_DIRECTORY
      ${BUILD_PATH}
    DEPENDS
      ${bunDeps}
    ARTIFACTS
      ${BUILD_PATH}/${bunPath}.zip
  )
endforeach()
