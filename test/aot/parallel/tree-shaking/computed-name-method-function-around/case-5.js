export function staticFieldName() { return class { static [this.fifth()] = 5; }; }
export function fifth() { return "fifth"; }
