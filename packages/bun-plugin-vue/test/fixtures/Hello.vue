<script setup lang="ts">
defineProps<{
  msg: string
}>()
</script>

<template>
  <main>
    Oh hi there, {{ msg }}!
  </main>
</template>
