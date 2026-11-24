// COUNTER: operationAOTGetByIdAndCache <= 200
// Weather bulletins go out as answers without a socket, of three families below node:http's ServerResponse. What the library keeps on an answer lies under names of its own: each bulletin's head reads them off another object, and where a family has them is found once and remembered.
import { ServerResponse } from "node:http";

class Bulletin extends ServerResponse {
  #lines = 0;
  letters = 0;
  say(text) {
    this.#lines++;
    this.letters += text.length;
    return this;
  }
  get lines() {
    return this.#lines;
  }
}

class StormWarning extends Bulletin {
  constructor(question, force) {
    super(question);
    this.force = force;
  }
}

const Fog = function () {};
Fog.prototype = Object.create(ServerResponse.prototype, { sight: { value: 40, writable: true, configurable: true } });

const question = (method, minor) => ({ method, httpVersionMajor: 1, httpVersionMinor: minor, headers: { host: "lighthouse" } });
const families = [
  minute => new Bulletin(question("GET", 1)).say("at " + minute),
  minute => new StormWarning(question(minute % 10 ? "GET" : "HEAD", 1), minute % 12),
  minute => Reflect.construct(ServerResponse, [question("GET", minute & 1)], Fog),
];

function send(minute, family) {
  const bulletin = families[family](minute);
  bulletin.sendDate = false;
  if (minute & 1) bulletin.setHeader("Wind", minute % 30);
  if (minute % 4) bulletin.writeHead(minute % 7 ? 200 : 404, { gust: minute % 9 });
  else bulletin.writeHead(203, "Told By Neighbors", ["Gust", String(minute % 9)]);
  return bulletin;
}

const tide = { heads: 0, sent: 0, code: 0, sight: 0, letters: 0, lines: 0, force: 0 };
for (let minute = 0; minute < 1440; minute++) {
  const bulletin = send(minute, minute % 3);
  if (bulletin.headersSent) tide.sent++;
  tide.heads += bulletin.getHeaderNames().length;
  tide.code += bulletin.statusCode;
  tide.sight += bulletin.sight ?? 0;
  tide.letters += bulletin.letters ?? 0;
  tide.lines += bulletin.lines ?? 0;
  tide.force += bulletin.force ?? 0;
  if (minute % 360 === 359) console.log(minute, JSON.stringify(tide), bulletin.getHeader("wind"), bulletin.statusMessage);
}

// One bulletin of each family whose own names are laid over, taken away and laid again, one by one, between the reads of the library.
for (let family = 0; family < 3; family++) {
  const bulletin = families[family](7);
  let told = "";
  for (const name of Object.getOwnPropertySymbols(bulletin)) {
    const held = bulletin[name];
    let looks = 0;
    Object.defineProperty(bulletin, name, { get: () => (looks++, held), set: () => void (looks += 100), configurable: true });
    try {
      bulletin.setHeader("tide", "low");
      told += bulletin.hasHeader("Tide") && bulletin.getHeader("tide") === "low" ? "h" : "-";
    } catch (error) {
      told += error.name;
    }
    told += looks > 0 ? "r" : ".";
    delete bulletin[name];
    told += name in bulletin ? "a " : "g ";
    bulletin[name] = held;
  }
  try {
    bulletin.writeHead(200 + family);
    bulletin.writeHead(500);
  } catch (error) {
    told += error.code;
  }
  console.log(family, told, bulletin.statusCode, bulletin.headersSent);
}
