// A static field under a created symbol beside the one that is counted.
const tag = Symbol("tag");
class Plain { static total = 0; static tag = "plain"; static count(by) { Plain.total = (Plain.total + by) | 0; return Plain.total; } }
class Tagged { static total = 0; static [tag] = "tagged"; static count(by) { Tagged.total = (Tagged.total + by) | 0; return Tagged.total; } }
export const loops = {
  "beside a static field under a name": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + Plain.count(i)) | 0; return s + Plain.tag.length; },
  "beside a static field under a symbol": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + Tagged.count(i)) | 0; return s + Tagged[tag].length; },
};
