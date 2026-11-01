(function (root) {
  root.rootedCount = (root.rootedCount || 0) + 1;
  root.rooted = function (list) {
    return list.length + root.rootedCount;
  };
})(this);
