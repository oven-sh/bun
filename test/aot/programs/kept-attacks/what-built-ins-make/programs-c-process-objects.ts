// process.versions, process.release and process.features are ordinary objects that native code fills: strings, and booleans among the features. What a program stores there stays what it is.
const say = (...values: unknown[]) => console.log(...values);
say(typeof process.versions.bun, typeof process.versions.node, process.versions.v8.length > 0, (process.versions as any).nobody, process.versions === process.versions, Object.values(process.versions).every(version => typeof version === "string"));
say(process.release.name.toUpperCase(), typeof process.release.sourceUrl, typeof process.release.headersUrl, (process.release as any).lts, Object.keys(process.release).join());
const features = process.features as unknown as Record<string, unknown>;
say(features.tls, features.ipv6, typeof features.typescript, features.nobody, Object.values(features).every(feature => typeof feature === "boolean" || typeof feature === "string"));
say(typeof process.versions.toString, process.versions.hasOwnProperty("bun"), Object.getPrototypeOf(process.release) === Object.prototype, JSON.stringify(process.release).length > 10);
const kept = { toString() { say("never run"); return ""; }, call: () => "a function of the program" };
(process.versions as any).mine = kept; say((process.versions as any).mine === kept, (process.versions as any).mine.call());
(process.features as any).mine = () => "called"; say((process.features as any).mine());
(process.release as any).name = 7; say(process.release.name, delete (process.release as any).sourceUrl, process.release.sourceUrl);
(process as any).versions = { other: () => "replaced" }; say((process.versions as any).other());
