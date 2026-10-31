export function classMethodName() { return class { [this.fourth()]() {} }; }
export function fourth() { return "fourth"; }
