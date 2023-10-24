(function (){"use strict";// build2/tmp/thirdparty/isomorphic-fetch.ts
var bunFetch = Bun.fetch;
var fetch = (...args) => bunFetch(...args);
fetch.default = fetch;
fetch.fetch = fetch;
return fetch})
