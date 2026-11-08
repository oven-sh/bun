var lists = [{ a: 1 }, { b: 2 }];
for (var i = 0; i < lists.length; i++) {
  var module = lists[i];
  for (var key in module) if (Object.prototype.hasOwnProperty.call(module, key)) exports[key] = module[key];
}
