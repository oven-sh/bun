-- wrk script: BODY_BYTES turns the request into a POST, PIPELINE sends that many requests per write.
local bytes, depth = tonumber(os.getenv("BODY_BYTES")), tonumber(os.getenv("PIPELINE"))
if bytes then
  wrk.method = "POST"
  wrk.body = string.rep("x", bytes)
end
if depth then
  local batch
  function init() batch = string.rep(wrk.format(), depth) end
  function request() return batch end
end

function done(summary, latency)
  local e = summary.errors
  -- wrk counts a read error for every response that closes the connection.
  if os.getenv("CLOSES") then e.read = 0 end
  io.write(string.format('{"requests":%d,"seconds":%f,"mean":%f,"p50":%d,"p99":%d,"errors":%d}\n',
    summary.requests, summary.duration / 1e6, latency.mean, latency:percentile(50), latency:percentile(99),
    e.connect + e.read + e.write + e.status + e.timeout))
end
