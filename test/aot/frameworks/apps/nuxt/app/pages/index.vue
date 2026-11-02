<script setup lang="ts">
useHead({ title: "smoke" });
</script>
<template><main><h1>a static page</h1><ul><li v-for="n in [1, 2, 3]" :key="n">{{ n * n }}</li></ul><Counter :start="5" /></main></template>
