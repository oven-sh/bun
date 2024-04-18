bun=$1
out=$2

features=$(
  BUN_DEBUG_QUIET_LOGS=1 \
  BUN_GARBAGE_COLLECTOR_LEVEL=0 \
  BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 \
  $bun --print 'JSON.stringify(require("bun:internal-for-testing").crash_handler.getFeatureList())'
)

echo '// The following data is used to decode features from crash reports.' > $out
echo '// It is generated off of the bun.analytics.Features struct.' >> $out
echo "$features" >> $out
