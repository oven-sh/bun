// constructor as a static member, prototype as an instance member, both as computed names, a quoted constructor, two methods of one name, and a comma expression in parentheses as a computed name.
class C { static constructor() {} }
class C { constructor() {} static constructor() {} }
class C { static constructor() {} static "constructor"() {} }
class C { static *constructor() {} }
class C { static get constructor() { return 1; } }
class C { prototype = 1; }
class C { get prototype() { return 1; } }
class C { ["constructor"] = 1; }
class C { "constructor"() {} }
class C { m() {} m() {} }
class C { static ["prototype"] = 1; }
class C { [(a, b)] = 1; }
