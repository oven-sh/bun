// A getter takes no parameter. A setter takes exactly one, which is not a rest parameter. The literal with a rest parameter is an argument, because bun run drops an unused one before JavaScriptCore reads it.
({ get a(b) {} });
({ set a() {} });
({ set a(b, c) {} });
f({ set a(...b) {} });
class C { get a(b) {} }
class C { set a() {} }
class C { static set a(...b) {} }
