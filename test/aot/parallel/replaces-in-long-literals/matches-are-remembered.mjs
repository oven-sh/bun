// The matches in a long literal are remembered from one replace to the next: what a function makes of them, and what is done to the pattern in between, is not.
const words = "0=1(2,3)4[5];6.7 8+9-a*b/c%d!e?f:g<h>i&j|k^l~m{n}o@p#q$r_s;t,u.v w(x)y[z] ";
const long = "alpha beta.gamma(delta) alpha_1 = beta2; epsilon zeta, eta theta! iota kappa: lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega 0=1(2,3)4[5];6.7 8+9-a*b/c%d!e?f:g<h>i&j|k^l~m{n}o@p#q$r_s;t,u.v w(x)y[z] alpha beta.gamma(delta) alpha_1 = beta2; epsilon zeta, eta theta! iota kappa: lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega 0=1(2,3)4[5];6.7 8+9-a*b/c%d!e?f:g<h>i&j|k^l~m{n}o@p#q$r_s;t,u.v w(x)y[z] alpha beta.gamma(delta) alpha_1 = beta2; epsilon zeta, eta theta! iota kappa: lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega 0=1(2,3)4[5];6.7 8+9-a*b/c%d!e?f:g<h>i&j|k^l~m{n}o@p#q$r_s;t,u.v w(x)y[z] alpha beta.gamma(delta) alpha_1 = beta2; epsilon zeta, eta theta! iota kappa: lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega 0=1(2,3)4[5];6.7 8+9-a*b/c%d!e?f:g<h>i&j|k^l~m{n}o@p#q$r_s;t,u.v w(x)y[z] a, c2.c2]alpha[delta gamma; y_2[delta=9; a)alpha)omega, gamma=gamma; gamma[gamma(alpha delta)gamma(x1.delta]b)gamma)omega, alpha.omega(gamma, beta.x1 a.beta, y_2, pi.gamma[pi(alpha, alpha.omega 9=y_2=a pi c2(a)beta)pi.9.9, pi; a.x1 omega; delta.9.gamma.x1]beta, b.x1(beta(c2, pi(c2 beta]omega delta.x1[b=gamma b pi.delta(c2(b=beta(omega.gamma omega, gamma[a(9[pi.pi, x1[omega(beta=9(b[y_2(beta[x1]9]y_2; y_2 x1.9, pi, c2, y_2(a pi]x1.b, pi, 9.y_2, b.c2=y_2(c2[y_2.9(9(delta.pi, c2; c2=gamma]b=x1]b, c2 delta(a[a(delta(b pi)gamma gamma; y_2(pi)9 omega[y_2=b; a)delta.alpha.omega, omega; c2]y_2 9, beta, 9]y_2, y_2(omega=a]y_2[gamma(a=a[delta(a; y_2 omega; y_2]gamma.b=omega=delta[x1[c2=omega(a, c2, pi, omega y_2, pi, gamma[alpha; b[delta, alpha(omega pi]9, delta[alpha)pi, gamma, x1[a[9; alpha(x1, 9.a, c2]alpha[y_2.b(alpha x1]pi; b]delta omega=a[omega[omega)x1[beta, alpha=a, b[x1(gamma[c2]pi.9(omega]alpha; c2)x1; beta y_2=beta=c2[alpha; beta)a; c2(x1[gamma(a(omega(beta)alpha]beta=c2; x1 a; c2=a(alpha=beta.b[pi.b.alpha(c2, gamma]x1]9)x1; 9)x1, 9(delta.pi=gamma(c2 b.beta beta; 9[delta=pi[y_2; 9 9=alpha(omega)c2; beta[delta(c2=y_2)x1.a.omega=gamma.b, b=y_2]alpha)c2(omega; beta alpha(delta)alpha[pi.alpha=pi, a=y_2[pi; delta(b(beta.omega[gamma]x1; x1(x1)alpha[alpha.y_2.alpha b[pi(beta.x1[b)c2(alpha)c2 a)b; a=c2.b, gamma[y_2, beta[gamma)gamma)alpha=c2, alpha[alpha[b=gamma alpha]9.beta; delta[beta[alpha)b pi=alpha x1=pi, b alpha)gamma]b=delta]delta; y_2; beta]gamma; c2)a pi]y_2[omega=9(c2 x1[delta]beta(x1[beta, omega.gamma(9; pi)c2; omega)x1 pi)alpha)x1.beta; omega.omega]alpha, b(a pi(c2 c2 c2=x1; omega]gamma.beta, gamma(x1[b.x1 beta]c2]alpha beta gamma.omega, a delta]omega(y_2)y_2.alpha(a(c2; x1]a(b(pi=omega; y_2.pi)pi=gamma[alpha(9[pi beta(omega delta alpha)pi.omega[delta)x1)x1]9.delta.y_2)b a[omega.gamma(delta[omega beta(omega; c2, delta.pi[9; delta=c2 beta]a(omega y_2 a, 9=9[9=pi]b 9(omega.a b]delta, x1; alpha; y_2=x1 x1)beta beta, y_2]delta[9; beta)y_2]omega=alpha=omega(b]delta.omega.beta]c2.delta; delta, x1, a; gamma; b=gamma)b; a]c2=omega)omega[9)x1=x1; a.gamma=alpha(beta, a]a(omega)y_2; b.c2; alpha[gamma]beta.delta[b=delta[beta delta(beta; y_2(y_2; a[c2.gamma]a; y_2; beta)delta.y_2(pi; delta=9[omega beta.gamma pi=y_2; pi, alpha; pi.c2)y_2=gamma, pi; a; x1=y_2; 9=alpha)omega)x1; gamma, beta]pi=gamma]omega)beta[y_2(beta gamma.alpha x1]pi=9; alpha)delta[alpha[9; x1[9 alpha(omega]omega delta omega=omega=alpha(y_2(x1)omega; y_2)omega=delta, gamma[y_2, alpha; gamma[beta; b=alpha=gamma)b c2[y_2[gamma[delta; y_2 alpha(omega; x1(b.y_2)gamma, 9]beta, beta; b=y_2, y_2[9[delta(x1 9 c2=gamma)pi alpha delta=delta]c2)x1 9)alpha=y_2 9, pi[beta; y_2]x1=omega, gamma; b[alpha)9=beta]x1]y_2=gamma[y_2; pi a)a[alpha c2; beta.gamma.y_2, x1[gamma; x1, alpha, omega(b)c2, a[gamma(a c2.9; alpha[alpha[b alpha=beta=c2]a[a)9; c2; c2; alpha; c2[x1]9; b, beta=x1, pi, x1 y_2]b[pi=gamma)x1.a)pi; gamma.beta=pi]b=gamma)gamma[gamma]pi.alpha(omega, a[9]delta]delta(omega]x1.x1; delta, omega.9, pi; beta; y_2; beta, a(alpha]omega(b.c2, beta=y_2; x1; x1.omega=beta; x1; gamma beta]omega; pi=beta)omega a]x1; b]y_2.beta[omega; gamma)beta]beta; b]omega=beta, x1]pi=alpha)9(omega(delta.c2]beta(x1 b[x1[9]x1, gamma, pi[omega; gamma)pi; pi)gamma)gamma; c2[x1[b(c2[beta, a, b.c2 9]beta)alpha.a[b[9, a.alpha, gamma]omega, omega.gamma, b)c2 alpha[gamma, omega, omega[y_2]9.c2 gamma[b 9[pi.alpha)9 pi; c2)gamma(9)b=b; omega=b)b, alpha)b)a; c2]y_2=a, delta; y_2]a]pi x1]alpha(omega pi delta)beta(pi[pi[x1]beta c2[a)alpha[9)beta.delta; 9.beta(delta=alpha omega x1)c2=omega(beta=c2)delta(omega[gamma=alpha, pi]";
const table = { alpha: "A", beta: "", gamma: undefined, a: 1, __proto__: { b: "inherited" } };
const out = [];
let hash = 0;
function say(value) {
  const text = String(value);
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  out.push(text.length);
}
for (let turn = 0; turn < 3; turn++) {
  const word = new RegExp("\\b\\w+\\b", "g");
  say(long.replace(word, name => table[name]));
  say(RegExp.lastMatch + RegExp.leftContext.length);
  let calls = 0;
  say(long.replace(word, (name, at, all) => { if (++calls === 7) word.lastIndex = 3; return at % 5 || all.length; }));
  say(word.lastIndex);
  try {
    long.replace(word, name => { if (++calls > 900) throw new Error(name); return name; });
  } catch (error) {
    say(error.message);
  }
  say(long.replace(word, name => words.replace(/\w/g, inner => inner + turn).length + name.length));
  say(long.replace(/(\w)(\d)?/g, (all, first, second) => second ?? first.toUpperCase()));
  say(long.replace(/x*/g, (...given) => given.length));
  say((long + turn).replace(word, name => name[0]));
  say(long.replace(/zzz/g, () => "never"));
  say(RegExp.lastMatch);
  if (turn === 1) Object.defineProperty(word, "flags", { value: "" });
  say(long.replace(word, "$&-"));
}
console.log(hash, out.join());
