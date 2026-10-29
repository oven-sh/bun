#!/bin/bash
# Generates a corpus of well-formed JPEG streams of every kind with cjpeg and jpegtran.
set -u
T=/root/ref/build-tools; I=/root/ref/libjpeg-turbo/testimages; O=/root/ref/corpus/gen
rm -rf $O; mkdir -p $O
S=$(mktemp -d); trap 'rm -rf $S' EXIT
failed=0
run() { tool=$1; out=$2; shift 2; $T/$tool-static "$@" > $O/$out 2>/dev/null || { echo "$tool failed: $out"; rm -f $O/$out; failed=1; }; }
cj() { run cjpeg "$@"; }
jt() { run jpegtran "$@"; }
# Crops of the source image at awkward sizes, as PPM.
python3 - <<'PY'
import struct
def read_ppm(p):
    d=open(p,'rb').read()
    parts=d.split(maxsplit=4)
    w,h=int(parts[1]),int(parts[2]); return w,h,parts[4][-w*h*3:]
w,h,px=read_ppm('/root/ref/libjpeg-turbo/testimages/testorig.ppm')
import os
os.makedirs('/root/ref/corpus/ppm',exist_ok=True)
for (cw,ch) in [(1,1),(2,2),(3,3),(5,7),(8,8),(9,9),(15,17),(16,16),(17,15),(31,33),(32,32),(33,31),(47,3),(3,47),(64,64),(65,1),(1,65),(100,75),(227,149),(128,17),(17,128)]:
    rows=[px[(y*w)*3:(y*w+cw)*3] for y in range(ch)]
    open('/root/ref/corpus/ppm/c%dx%d.ppm'%(cw,ch),'wb').write(b'P6\n%d %d\n255\n'%(cw,ch)+b''.join(rows))
    g=bytes((r*77+gg*150+b*29)>>8 for row in rows for r,gg,b in zip(row[0::3],row[1::3],row[2::3]))
    open('/root/ref/corpus/ppm/c%dx%d.pgm'%(cw,ch),'wb').write(b'P5\n%d %d\n255\n'%(cw,ch)+g)
PY
for f in /root/ref/corpus/ppm/*.ppm; do
  b=$(basename $f .ppm)
  for s in 1x1 2x1 1x2 2x2 4x1 1x4 4x2 2x4 4x4 3x1 1x3 3x3 3x2 2x3; do
    cj ${b}_s$s.jpg -quality 85 -sample $s $f
  done
  for s in 1x1 2x2 2x1 1x2; do
    cj ${b}_s${s}_prog.jpg -quality 75 -sample $s -progressive $f
    cj ${b}_s${s}_ari.jpg -quality 75 -sample $s -arithmetic $f
    cj ${b}_s${s}_ariprog.jpg -quality 75 -sample $s -arithmetic -progressive $f
    cj ${b}_s${s}_rst1.jpg -quality 75 -sample $s -restart 1 $f
    cj ${b}_s${s}_rst3b.jpg -quality 75 -sample $s -restart 3B $f
    cj ${b}_s${s}_opt.jpg -quality 75 -sample $s -optimize $f
    cj ${b}_s${s}_progrst.jpg -quality 75 -sample $s -progressive -restart 2B $f
    cj ${b}_s${s}_arirst.jpg -quality 75 -sample $s -arithmetic -restart 2B $f
  done
  cj ${b}_rgb.jpg -rgb $f
  cj ${b}_rgbprog.jpg -rgb -progressive $f
  cj ${b}_gray.jpg -grayscale $f
  cj ${b}_grayprog.jpg -grayscale -progressive $f
  for q in 1 5 10 25 50 90 95 100; do cj ${b}_q$q.jpg -quality $q $f; done
  cj ${b}_q1nb.jpg -quality 1 $f
  cj ${b}_q1base.jpg -quality 1 -baseline $f
  for p in 1 2 3 4 5 6 7; do cj ${b}_ll$p.jpg -lossless $p $f; cj ${b}_ll${p}pt2.jpg -lossless $p,2 $f; done
  cj ${b}_llrst.jpg -lossless 4 -restart 1 $f
  for p in 1 4 7; do for pt in 0 2; do
    printf "0: $p 0 0 $pt;\n1: $p 0 0 $pt;\n2: $p 0 0 $pt;\n" > $S/s3.scan
    printf "0: $p 0 0 $pt;\n1 2: $p 0 0 $pt;\n" > $S/s2.scan
    for sc in s3 s2; do
      cj ${b}_ll${p}pt${pt}_$sc.jpg -lossless $p,$pt -scans $S/$sc.scan $f
      cj ${b}_ll${p}pt${pt}_${sc}rst.jpg -lossless $p,$pt -scans $S/$sc.scan -restart 1 $f
    done
  done; done
  for pr in 2 3 4 5 6 7; do cj ${b}_llprec$pr.jpg -lossless 1 -precision $pr $f; done
  cj ${b}_p12.jpg -precision 12 $f
  cj ${b}_ll12.jpg -precision 12 -lossless 1 $f
  cj ${b}_ll16.jpg -precision 16 -lossless 1 $f
  cj ${b}_icc.jpg -icc $I/test1.icc $f
  cj ${b}_icc3.jpg -icc $I/test3.icc $f
  cj ${b}_scans.jpg -scans $I/test.scan $f
  cj ${b}_smooth.jpg -smooth 50 $f
  cj ${b}_fast.jpg -dct fast $f
  cj ${b}_float.jpg -dct float $f
done
for f in /root/ref/corpus/ppm/*.pgm; do
  b=$(basename $f .pgm)
  cj ${b}_g.jpg $f; cj ${b}_gprog.jpg -progressive $f; cj ${b}_gari.jpg -arithmetic $f; cj ${b}_gll.jpg -lossless 1 $f
  cj ${b}_gs2x2.jpg -sample 2x2 $f; cj ${b}_gs1x2.jpg -sample 1x2 $f; cj ${b}_gs3x4.jpg -sample 3x4 $f
  cj ${b}_grst.jpg -restart 1B $f
done
# Transforms of a few of them (4:4:0 from rotating 4:2:2, non-interleaved scans, and so on).
for f in $O/c100x75_s2x1.jpg $O/c227x149_s2x2.jpg $O/c33x31_s2x1.jpg $O/c227x149_s4x1.jpg; do
  b=$(basename $f .jpg)
  for x in "rotate 90" "rotate 270" "transpose" "flip horizontal"; do
    jt ${b}_$(echo $x | tr -d ' ').jpg -$x $f
  done
  jt ${b}_tprog.jpg -progressive $f
  jt ${b}_tari.jpg -arithmetic $f
done
# Non-interleaved sequential scans.
printf '0;\n1;\n2;\n' > $S/noninter.scan
printf '0 1;\n2;\n' > $S/partinter.scan
for f in /root/ref/corpus/ppm/c100x75.ppm /root/ref/corpus/ppm/c33x31.ppm /root/ref/corpus/ppm/c17x128.ppm; do
  b=$(basename $f .ppm)
  for s in 1x1 2x2 2x1; do
    cj ${b}_s${s}_nonint.jpg -sample $s -scans $S/noninter.scan $f
    cj ${b}_s${s}_partint.jpg -sample $s -scans $S/partinter.scan $f
    cj ${b}_s${s}_nonintari.jpg -sample $s -arithmetic -scans $S/noninter.scan $f
    cj ${b}_s${s}_nonintrst.jpg -sample $s -restart 2B -scans $S/noninter.scan $f
  done
done
ls $O | wc -l
exit $failed
