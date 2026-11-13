const log = [];
function may(x) { if (x === 1) throw new RangeError("r"); return x; }
function withWhile(n) { let s = ""; let j = 0; while (j < 2) { j++; try { may(n); log.push(s); } catch (e) { s += "c"; } } return s + "/"; }
function withForOf(n) { let s = ""; for (const j of [0, 1]) { try { may(n); log.push(s); } catch (e) { s += "c"; } } return s + "/"; }
function withWrittenOutAppend(n) { let s = ""; for (let j = 0; j < 2; j++) { try { may(n); log.push(s); } catch (e) { s = s + "c"; } } return s + "/"; }
function withUnshift(n) { let s = ""; for (let j = 0; j < 2; j++) { try { may(n); log.withUnshift(s); } catch (e) { s += "c"; } } return s + "/"; }
function withConcat(n) { let s = ""; let t = "t"; for (let j = 0; j < 2; j++) { try { may(n); t = t.withConcat(s); } catch (e) { s += "c"; } } return s + "/" + t; }
function withCharAt(n) { let s = ""; let t = ""; for (let j = 0; j < 2; j++) { try { may(n); t = s.withCharAt(0); } catch (e) { s += "c"; } } return s + "/" + t; }
function withFinallyAppends(n) { let s = ""; for (let j = 0; j < 2; j++) { try { may(n); log.push(s); } catch (e) { s += "c"; } finally { s += "f"; } } return s + "/"; }
for (const read of [() => [withWhile(0), withWhile(1), withWhile(2)], () => [withForOf(0), withForOf(1), withForOf(2)], () => [withWrittenOutAppend(0), withWrittenOutAppend(1), withWrittenOutAppend(2)], () => [withUnshift(0), withUnshift(1), withUnshift(2)], () => [withConcat(0), withConcat(1), withConcat(2)], () => [withCharAt(0), withCharAt(1), withCharAt(2)], () => [withFinallyAppends(0), withFinallyAppends(1), withFinallyAppends(2)]]) console.log(read().join(" "), log.splice(0).join("|"));
