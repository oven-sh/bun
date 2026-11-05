function attempt(make) { try { console.log(String(make())); } catch (e) { console.log(e.name); } }
attempt(() => Reflect.construct((function () {}).constructor, ["return 1 + 1"])());
