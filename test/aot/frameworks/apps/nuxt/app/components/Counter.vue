<script setup lang="ts">
const props = defineProps<{ start: number }>();
const count = ref(props.start);
</script>
<template><button @click="count++">clicked {{ count }} times</button></template>
