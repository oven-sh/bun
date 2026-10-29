// RUN(DIRECT): lower
// DIRECT: function {{*}}name="direct"{{*}}flags=[HasThis,

// RUN(INDIRECT): lower
// INDIRECT: function {{*}}name="indirect"{{*}}flags=[HasThis,

// RUN(ARROW): lower
// ARROW: function {{*}}kind=Arrow{{*}}captures=[{

// RUN(UNUSED): lower
// UNUSED-NOT: name="unused"{{*}}HasThis
// UNUSED-NOT: kind=Arrow{{*}}HasThis

export const object = {
  value: 1,
  unused() {
    return 1;
  },
  direct() {
    return this.value;
  },
  indirect() {
    return () => this.value;
  },
};
