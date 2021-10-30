# Upcoming release

- [.env loader] Pass through process environment variable values verbatim instead of treating them similarly to .env files. `.env` needs special parsing because quotes are optional, values are potentially nested, and it's whitespace sensitive. This probably also improves the performance of loading process environment variables, but that was already pretty quick so it probably doesn't matter.
