register_vendor_target(picohttpparser)

register_repository(
  NAME
    ${picohttpparser}
  REPOSITORY
    h2o/picohttpparser
  COMMIT
    066d2b1e9ab820703db0837a7255d92d30f0c9f5
  OUTPUTS
    picohttpparser.c
)
