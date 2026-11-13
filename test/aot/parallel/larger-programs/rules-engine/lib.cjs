// Rules over facts: patterns with variables, joins that are kept, an agenda by priority and age, actions that assert and retract, truth that is kept, explanations, queries
'use strict';
function Fact(type, fields, id) {
  this.type = type;
  this.fields = fields;
  this.id = id;
  this.because = [];
  this.supports = [];
  this.alive = true;
  this.given = false;
}
Fact.prototype.toString = function () {
  var f = this.fields;
  return this.type + '(' + Object.keys(f).map(function (k) {
    return k + '=' + f[k];
}).join(',') + ')';
};
Fact.prototype.key = function () {
  var f = this.fields;
  return this.type + ':' + Object.keys(f).sort().map(function (k) {
    return k + '=' + typeof f[k] + f[k];
}).join(';');
};
function Pattern(type, tests, options) {
  this.type = type;
  this.tests = tests;
  this.negated = !!(options && options.negated);
  this.as = options && options.as;
  this.guard = options && options.guard;
  this.matched = 0;
}
Pattern.prototype.match = function (fact, env) {
  this.matched++;
  if (fact.type !== this.type) return null;
  var out = null;
  for (var k in this.tests) {
    var want = this.tests[k], have = fact.fields[k];
    if (have === undefined) return null;
    if (typeof want === 'function') {
      if (!want(have, out || env)) return null;
  } else if (typeof want === 'string' && want[0] === '?') {
      var bound = (out || env)[want];
      if (bound === undefined) {
        out = out || Object.assign({}, env);
        out[want] = have;
    } else if (bound !== have) return null;
  } else if (want !== have) return null;
  }
  if (this.guard && !this.guard(out || env)) return null;
  out = out || Object.assign({}, env);
  if (this.as) out[this.as] = fact;
  return out;
};
function Rule(name, when, then, options) {
  this.name = name;
  this.when = when;
  this.then = then;
  this.priority = (options && options.priority) || 0;
  this.logical = !!(options && options.logical);
  this.fired = 0;
  this.limit = (options && options.limit) || Infinity;
}
function Activation(rule, env, facts, age) {
  this.rule = rule;
  this.env = env;
  this.facts = facts;
  this.age = age;
  this.key = rule.name + '|' + facts.map(function (f) {
    return f ? f.id : '-';
}).join();
}
function Engine() {
  this.facts = new Map();
  this.byType = new Map();
  this.keys = new Map();
  this.rules = [];
  this.agenda = [];
  this.done = new Set();
  this.next = 1;
  this.steps = 0;
  this.log = [];
  this.current = null;
  this.listeners = {
    assert: [], retract: [], fire: []
};
  this.clock = 0;
}
Engine.prototype.on = function (event, f) {
  if (!this.listeners[event]) throw new TypeError('no event ' + event);
  this.listeners[event].push(f);
  return this;
};
Engine.prototype.tell = function (event, what) {
  for (var i = 0; i < this.listeners[event].length; i++) this.listeners[event][i].call(this,
    what);
};
Engine.prototype.rule = function (name, when, then, options) {
  if (this.rules.some(function (r) {
    return r.name === name;
})) throw new TypeError('rule twice: ' + name);
  this.rules.push(new Rule(name, when, then, options));
  return this;
};
Engine.prototype.assert = function (type, fields) {
  var fact = new Fact(type, fields, this.next), key = fact.key(), old = this.keys.get(key);
  if (old) {
    if (!this.current) old.given = true;
    else this.support(old);
    return old;
  }
  this.next++;
  this.facts.set(fact.id, fact);
  this.keys.set(key, fact);
  var list = this.byType.get(type);
  if (list) list.push(fact);
  else this.byType.set(type, [fact]);
  if (this.current) this.support(fact);
  else fact.given = true;
  this.tell('assert', fact);
  this.activate(fact);
  return fact;
};
Engine.prototype.support = function (fact) {
  var a = this.current;
  if (!a.rule.logical) {
    fact.given = true;
    return;
  }
  var s = {
    rule: a.rule.name, facts: a.facts.filter(Boolean), of: fact, gone: false
};
  fact.because.push(s);
  s.facts.forEach(function (f) {
    f.supports.push(s);
});
};
Engine.prototype.retract = function (fact) {
  if (!fact.alive) return false;
  fact.alive = false;
  this.facts.delete(fact.id);
  this.keys.delete(fact.key());
  var list = this.byType.get(fact.type);
  list.splice(list.indexOf(fact), 1);
  this.agenda = this.agenda.filter(function (a) {
    return a.facts.indexOf(fact) < 0;
});
  this.tell('retract', fact);
  var self = this;
  fact.supports.forEach(function (s) {
    if (s.gone || !s.of.alive) return;
    s.gone = true;
    s.of.because = s.of.because.filter(function (x) {
      return x !== s;
  });
    if (!s.of.given && !s.of.because.length) self.retract(s.of);
});
  this.reactivate(fact);
  return true;
};
Engine.prototype.modify = function (fact, changes) {
  this.retract(fact);
  return this.assert(fact.type, Object.assign({}, fact.fields, changes));
};
Engine.prototype.ofType = function (type) {
  return this.byType.get(type) || [];
};
Engine.prototype.join = function (rule, i, env, facts, must, found) {
  if (i === rule.when.length) {
    if (!must || facts.indexOf(must) >= 0) found.push({ env: env, facts: facts });
    return;
  }
  var p = rule.when[i];
  if (p.negated) {
    var list = this.ofType(p.type);
    for (var k = 0; k < list.length; k++) if (p.match(list[k], env)) return;
    this.join(rule, i + 1, env, facts.concat([null]), must, found);
    return;
  }
  var all = this.ofType(p.type).slice();
  for (var j = 0; j < all.length; j++) {
    var next = p.match(all[j], env);
    if (next) this.join(rule, i + 1, next, facts.concat([all[j]]), must, found);
  }
};
Engine.prototype.activate = function (fact) {
  var self = this;
  this.rules.forEach(function (rule) {
    if (!rule.when.some(function (p) {
      return p.type === fact.type;
  })) return;
    if (rule.when.some(function (p) {
      return p.negated && p.type === fact.type;
  })) self.agenda = self.agenda.filter(function (a) {
      return a.rule !== rule || rule.when.every(function (p) {
        return !p.negated || p.type !== fact.type || !p.match(fact, a.env);
    });
  });
    var found = [];
    self.join(rule, 0, {}, [], rule.when.some(function (p) {
      return !p.negated && p.type === fact.type;
  }) ? fact : null, found);
    self.enqueue(rule, found);
});
};
Engine.prototype.reactivate = function (fact) {
  var self = this;
  this.rules.forEach(function (rule) {
    if (!rule.when.some(function (p) {
      return p.negated && p.type === fact.type;
  })) return;
    var found = [];
    self.join(rule, 0, {}, [], null, found);
    self.enqueue(rule, found);
});
};
Engine.prototype.enqueue = function (rule, found) {
  for (var i = 0; i < found.length; i++) {
    var a = new Activation(rule, found[i].env, found[i].facts, ++this.clock);
    if (this.done.has(a.key) || this.agenda.some(function (b) {
      return b.key === a.key;
  })) continue;
    this.agenda.push(a);
  }
};
Engine.prototype.run = function (limit) {
  for (var n = 0; n < (limit || 1e5); n++) {
    if (!this.agenda.length) return n;
    var best = 0;
    for (var i = 1; i < this.agenda.length; i++) {
      var a = this.agenda[i], b = this.agenda[best];
      if (a.rule.priority > b.rule.priority || (a.rule.priority === b.rule.priority &&
        a.age > b.age)) best = i;
    }
    var act = this.agenda.splice(best, 1)[0];
    this.done.add(act.key);
    if (act.rule.fired >= act.rule.limit) continue;
    act.rule.fired++;
    this.steps++;
    this.current = act;
    this.tell('fire', act);
    try {
      act.rule.then.call(this, act.env, act.facts);
  } catch (e) {
      this.log.push(act.rule.name + ' failed: ' + e.message);
  } finally {
      this.current = null;
    }
  }
  throw new RangeError('rules do not end');
};
Engine.prototype.query = function () {
  var patterns = [].slice.call(arguments), found = [];
  this.join({ when: patterns }, 0, {}, [], null, found);
  return found.map(function (f) {
    return f.env;
});
};
Engine.prototype.explain = function (fact, depth) {
  depth = depth || 0;
  var pad = '  '.repeat(depth), self = this;
  if (depth > 6) return pad + '...\n';
  return pad + fact + (fact.given ? ' given' : '') + '\n' + fact.because.map(function (s) {
    return pad + ' by ' + s.rule + '\n' + s.facts.map(function (f) {
      return self.explain(f, depth + 1);
  }).join('');
}).join('');
};
function P(type, tests, options) {
  return new Pattern(type, tests || {}, options);
}
function not(type, tests) {
  return new Pattern(type, tests || {}, { negated: true });
}
module.exports = { Fact, Pattern, Rule, Activation, Engine, P, not };
