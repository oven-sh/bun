// Getters with no parameter and setters with one, which can have a default or be a pattern.
({ get a() { return 1; }, set a(b) {} });
({ set a(b = 1) {} });
({ set a([b]) {} });
class C { static get a() { return 1; } }
