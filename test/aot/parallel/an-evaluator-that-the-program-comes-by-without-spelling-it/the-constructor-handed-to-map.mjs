function attempt(make) { try { console.log(String(make())); } catch (e) { console.log(e.name); } }
attempt(() => ["return 1 + 1"].map((function () {}).constructor)[0]());
