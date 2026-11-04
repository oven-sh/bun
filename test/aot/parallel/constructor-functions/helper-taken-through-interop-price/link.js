function link(child, parent) {
  ((child.prototype = Object.create(parent.prototype)),
    (child.prototype.constructor = child),
    Object.setPrototypeOf(child, parent));
}
((module.exports = link), (module.exports.__esModule = true), (module.exports["default"] = module.exports));
